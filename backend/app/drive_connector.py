from googleapiclient.discovery import build
from app.gmail_connector import authenticate_gmail
from langchain_text_splitters import RecursiveCharacterTextSplitter
import io

def get_drive_service():
    creds = authenticate_gmail.__globals__['Credentials']
    from app.gmail_connector import TOKEN_FILE, SCOPES
    from google.oauth2.credentials import Credentials
    import os
    creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    return build('drive', 'v3', credentials=creds)


def get_drive_files(max_files: int = 15):
    try:
        service = get_drive_service()
        results = []

        response = service.files().list(
            pageSize=max_files,
            fields="files(id, name, mimeType)",
            q="trashed = false and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet')"
        ).execute()

        files = response.get('files', [])

        for f in files:
            try:
                content = extract_file_content(service, f['id'], f['mimeType'])
                if content and len(content) > 50:
                    results.append({
                        "title": f['name'],
                        "content": content[:3000],
                        "source": f"Drive: {f['name']}"
                    })
            except Exception as e:
                print(f"Error reading {f['name']}: {e}")
                continue

        return results

    except Exception as e:
        print(f"Drive error: {e}")
        return []


def extract_file_content(service, file_id, mime_type):
    export_mime = (
        'text/plain' if mime_type == 'application/vnd.google-apps.document'
        else 'text/csv'
    )
    request = service.files().export_media(fileId=file_id, mimeType=export_mime)
    content = request.execute()
    return content.decode('utf-8', errors='ignore')


def chunk_drive_files(files: list):
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    chunks = []
    for f in files:
        splits = splitter.split_text(f["content"])
        for i, split in enumerate(splits):
            chunks.append({
                "text": split,
                "source": f["source"],
                "chunk_index": i
            })
    return chunks
