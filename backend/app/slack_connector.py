from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from langchain_text_splitters import RecursiveCharacterTextSplitter

def get_slack_messages(slack_token: str):
    client = WebClient(token=slack_token)
    results = []

    try:
        # Get all channels
        channels_response = client.conversations_list(
            types="public_channel",
            limit=100
        )
        channels = channels_response.get("channels", [])

        for channel in channels:
            channel_id = channel["id"]
            channel_name = channel["name"]

            try:
                # Get messages from each channel
                history = client.conversations_history(
                    channel=channel_id,
                    limit=100
                )
                messages = history.get("messages", [])

                if not messages:
                    continue

                # Build content string
                content_parts = [f"Slack channel: #{channel_name}\n"]

                for msg in reversed(messages):
                    # Skip bot messages and system messages
                    if msg.get("subtype"):
                        continue
                    text = msg.get("text", "").strip()
                    if text:
                        content_parts.append(text)

                if len(content_parts) > 1:
                    results.append({
                        "channel": channel_name,
                        "content": "\n".join(content_parts),
                        "source": f"Slack: #{channel_name}"
                    })

            except SlackApiError as e:
                print(f"Error fetching #{channel_name}: {e}")
                continue

    except SlackApiError as e:
        print(f"Error fetching channels: {e}")

    return results


def chunk_slack_messages(channels: list):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=100
    )

    chunks = []
    for channel in channels:
        splits = splitter.split_text(channel["content"])
        for i, split in enumerate(splits):
            chunks.append({
                "text": split,
                "source": channel["source"],
                "channel": channel["channel"],
                "chunk_index": i
            })

    return chunks
