from notion_client import Client
from langchain_text_splitters import RecursiveCharacterTextSplitter

def get_notion_pages(notion_token: str):
    notion = Client(auth=notion_token)
    
    results = []
    
    try:
        # Search for all pages the integration has access to
        response = notion.search(
            filter={"property": "object", "value": "page"}
        )
        
        # ADD THIS LINE
        print("NOTION SEARCH RESULT:", response)
        
        for page in response.get("results", []):
            page_id = page["id"]
            
            # Get page title
            title = "Untitled"
            props = page.get("properties", {})
            for prop in props.values():
                if prop.get("type") == "title":
                    title_arr = prop.get("title", [])
                    if title_arr:
                        title = title_arr[0].get("plain_text", "Untitled")
                    break
            
            # Get page content
            content = extract_page_content(notion, page_id, title)
            if content:
                results.append({
                    "title": title,
                    "page_id": page_id,
                    "content": content,
                    "source": f"Notion: {title}"
                })
    
    except Exception as e:
        print(f"Error fetching Notion pages: {e}")
    
    return results


def extract_page_content(notion, page_id: str, title: str):
    try:
        blocks = notion.blocks.children.list(block_id=page_id)
        text_parts = [title + "\n"]
        
        for block in blocks.get("results", []):
            block_type = block.get("type")
            block_data = block.get(block_type, {})
            
            # Extract rich text from common block types
            if block_type in ["paragraph", "heading_1", "heading_2", 
                              "heading_3", "bulleted_list_item", 
                              "numbered_list_item", "quote", "callout"]:
                rich_text = block_data.get("rich_text", [])
                text = " ".join([t.get("plain_text", "") for t in rich_text])
                if text.strip():
                    text_parts.append(text)
        
        return "\n".join(text_parts)
    
    except Exception as e:
        print(f"Error extracting content from page {page_id}: {e}")
        return ""


def chunk_and_prepare(pages: list):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=100
    )
    
    chunks = []
    for page in pages:
        splits = splitter.split_text(page["content"])
        for i, split in enumerate(splits):
            chunks.append({
                "text": split,
                "source": page["source"],
                "page_id": page["page_id"],
                "chunk_index": i
            })
    
    return chunks
