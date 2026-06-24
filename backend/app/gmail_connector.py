import os
import json
import base64
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from langchain_text_splitters import RecursiveCharacterTextSplitter

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive.readonly'
]
CREDENTIALS_FILE = os.path.join(os.path.dirname(__file__), '..', 'credentials.json')
TOKEN_FILE = os.path.join(os.path.dirname(__file__), '..', 'gmail_token.json')


def authenticate_gmail():
    creds = None

    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception as e:
                print(f"Token refresh failed, re-authenticating: {e}")
                if os.path.exists(TOKEN_FILE):
                    os.remove(TOKEN_FILE)
                flow = InstalledAppFlow.from_client_secrets_file(
                    CREDENTIALS_FILE, SCOPES
                )
                creds = flow.run_local_server(port=0)
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDENTIALS_FILE, SCOPES
            )
            creds = flow.run_local_server(port=0)

        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())

    service = build('gmail', 'v1', credentials=creds)
    return service


def get_email_body(payload):
    """
    Extracts plain text body from email payload.
    """
    body = ""

    if "parts" in payload:
        for part in payload["parts"]:
            if part["mimeType"] == "text/plain":
                data = part["body"].get("data", "")
                if data:
                    body += base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
    else:
        data = payload["body"].get("data", "")
        if data:
            body = base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")

    return body.strip()


def get_gmail_messages(max_emails: int = 50):
    """
    Fetches recent emails from Gmail.
    """
    try:
        service = authenticate_gmail()
        results = []

        # Get list of messages
        messages_list = service.users().messages().list(
            userId='me',
            maxResults=max_emails,
            q="-category:promotions -category:social"
        ).execute()

        messages = messages_list.get('messages', [])

        for msg in messages:
            try:
                message = service.users().messages().get(
                    userId='me',
                    id=msg['id'],
                    format='full'
                ).execute()

                headers = message['payload']['headers']
                subject = next((h['value'] for h in headers
                               if h['name'] == 'Subject'), 'No Subject')
                sender = next((h['value'] for h in headers
                              if h['name'] == 'From'), 'Unknown')
                date = next((h['value'] for h in headers
                            if h['name'] == 'Date'), 'Unknown')

                body = get_email_body(message['payload'])

                if body and len(body) > 50:
                    results.append({
                        "subject": subject,
                        "sender": sender,
                        "date": date,
                        "body": body[:2000],
                        "source": f"Gmail: {subject[:50]}"
                    })

            except Exception as e:
                print(f"Error fetching email: {e}")
                continue

        return results

    except Exception as e:
        print(f"Gmail error: {e}")
        return []


def chunk_emails(emails: list):
    """
    Chunks email content for indexing.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=100
    )

    chunks = []
    for email in emails:
        content = (
            f"Email Subject: {email['subject']}\n"
            f"From: {email['sender']}\n"
            f"Date: {email['date']}\n\n"
            f"{email['body']}"
        )

        splits = splitter.split_text(content)
        for i, split in enumerate(splits):
            chunks.append({
                "text": split,
                "source": email["source"],
                "chunk_index": i
            })

    return chunks
