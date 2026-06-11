from notion_client import Client
import re

def detect_intent(question: str):
    """
    Detects if the user wants to take an action vs ask a question.
    Returns intent type and extracted entities.
    """
    q = question.lower()

    # Create task intent
    if any(word in q for word in ["create task", "add task", "create a task",
                                   "make a task", "create follow up",
                                   "add follow up", "remind", "schedule"]):
        return "CREATE_TASK", extract_task_details(question)

    # Summarize intent
    if any(word in q for word in ["summarize", "summary", "summarise"]):
        return "SUMMARIZE", {}

    # Send Slack message intent
    if any(word in q for word in ["send message", "send a message", 
                                   "message to", "notify", "ping",
                                   "send slack", "tell the team"]):
        return "SEND_SLACK", extract_slack_details(question)

    # Default - just a question
    return "QUESTION", {}


def extract_task_details(text: str):
    """
    Extracts task details from natural language.
    """
    details = {
        "title": text,
        "assignee": None,
        "due_date": None,
    }

    # Extract person name
    people = [
        "Rahul Sharma", "Priya Nair", "Dev Mehta",
        "Ananya Iyer", "Karan Joshi", "Vikram Rao"
    ]
    for person in people:
        if person.lower() in text.lower():
            details["assignee"] = person
            break

    # Clean up title
    title = text
    for word in ["create task", "create a task", "add task",
                 "create follow up", "add follow up", "remind"]:
        title = title.lower().replace(word, "").strip()
    details["title"] = title.capitalize()

    return details


def extract_slack_details(text: str):
    """
    Extracts Slack message details from natural language.
    """
    details = {
        "message": text,
        "channel": "general",
        "recipient": None
    }

    # Extract channel
    channels = ["general", "incidents", "engineering", 
                "operations", "random"]
    for channel in channels:
        if channel in text.lower():
            details["channel"] = channel
            break

    # Extract person
    people = {
        "Rahul Sharma": "general",
        "Priya Nair": "operations",
        "Dev Mehta": "engineering",
        "Ananya Iyer": "general",
        "Karan Joshi": "general",
        "Vikram Rao": "general"
    }
    for person, default_channel in people.items():
        if person.lower() in text.lower():
            details["recipient"] = person
            details["channel"] = default_channel
            break

    # Clean up message text
    message = text
    for word in ["send message", "send a message", "message to",
                 "notify", "ping", "send slack", "tell the team"]:
        message = message.lower().replace(word, "").strip()
    details["message"] = f"[NeuralOS] {message.capitalize()}"

    return details


def send_slack_message(slack_token: str, channel: str, message: str):
    """
    Sends a message to a Slack channel.
    """
    try:
        from slack_sdk import WebClient
        from slack_sdk.errors import SlackApiError

        client = WebClient(token=slack_token)

        response = client.chat_postMessage(
            channel=f"#{channel}",
            text=message,
            username="NeuralOS",
            icon_emoji=":robot_face:"
        )

        return {
            "success": True,
            "message": f"Message sent to #{channel}",
            "timestamp": response["ts"]
        }

    except Exception as e:
        return {
            "success": False,
            "message": f"Failed to send Slack message: {str(e)}"
        }


def create_notion_task(notion_token: str, task_title: str,
                       assignee: str = None, notes: str = ""):
    """
    Creates a task page in Notion.
    """
    try:
        notion = Client(auth=notion_token)

        # Search for a Tasks or Todo page to add to
        response = notion.search(
            query="Tasks",
            filter={"property": "object", "value": "page"}
        )

        parent_page_id = None
        for page in response.get("results", []):
            title_props = page.get("properties", {})
            for prop in title_props.values():
                if prop.get("type") == "title":
                    title_arr = prop.get("title", [])
                    if title_arr:
                        page_title = title_arr[0].get("plain_text", "")
                        if "task" in page_title.lower():
                            parent_page_id = page["id"]
                            break

        # Build page content
        children = [
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [
                        {
                            "type": "text",
                            "text": {
                                "content": f"Task created by NeuralOS\n"
                                          f"Assignee: {assignee or 'Unassigned'}\n"
                                          f"Notes: {notes or 'No additional notes'}"
                            }
                        }
                    ]
                }
            }
        ]

        # Create the page
        if parent_page_id:
            new_page = notion.pages.create(
                parent={"page_id": parent_page_id},
                properties={
                    "title": {
                        "title": [
                            {"type": "text", "text": {"content": task_title}}
                        ]
                    }
                },
                children=children
            )
        else:
            # Find any accessible page to use as parent
            all_pages = notion.search(
                filter={"property": "object", "value": "page"}
            )
            if all_pages.get("results"):
                parent_page_id = all_pages["results"][0]["id"]
                new_page = notion.pages.create(
                    parent={"page_id": parent_page_id},
                    properties={
                        "title": {
                            "title": [
                                {"type": "text", "text": {"content": task_title}}
                            ]
                        }
                    },
                    children=children
                )
            else:
                return {
                    "success": False,
                    "message": "No accessible Notion pages found. Make sure pages are connected to NeuralOS integration."
                }

        return {
            "success": True,
            "page_id": new_page["id"],
            "url": new_page.get("url", ""),
            "message": f"Task created: '{task_title}'"
                       + (f" assigned to {assignee}" if assignee else "")
        }

    except Exception as e:
        return {
            "success": False,
            "message": f"Failed to create task: {str(e)}"
        }
