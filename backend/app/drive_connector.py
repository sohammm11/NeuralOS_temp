from googleapiclient.discovery import build
from app.gmail_connector import authenticate_gmail
from langchain_text_splitters import RecursiveCharacterTextSplitter
import io
from app.multimodal import describe_image, format_for_search
from PIL import Image

def get_drive_service():
    from app.gmail_connector import authenticate_gmail
    gmail_service = authenticate_gmail()
    creds = gmail_service._http.credentials
    return build('drive', 'v3', credentials=creds)


def get_drive_files(max_files: int = 15):
    try:
        service = get_drive_service()
        results = []

        response = service.files().list(
            pageSize=max_files,
            fields="files(id, name, mimeType)",
            q="trashed = false"
        ).execute()

        files = response.get('files', [])
        print(f"DEBUG: Drive API returned {len(files)} files: {[f['name'] for f in files]}")

        for f in files:
            try:
                content = download_drive_file(service, f['id'], f['mimeType'])
                if content:
                    results.append({
                        "name": f['name'],
                        "mimeType": f['mimeType'],
                        "content": content
                    })
            except Exception as e:
                print(f"Error reading {f['name']}: {e}")
                continue

        return results

    except Exception as e:
        print(f"Drive error: {e}")
        return []


def download_drive_file(service, file_id: str, mime_type: str) -> bytes:
    try:
        if mime_type == 'application/vnd.google-apps.document':
            request = service.files().export_media(fileId=file_id, mimeType='text/plain')
            return request.execute()
        elif mime_type == 'application/vnd.google-apps.spreadsheet':
            request = service.files().export_media(fileId=file_id, mimeType='text/csv')
            return request.execute()
        else:
            request = service.files().get_media(fileId=file_id)
            return request.execute()
    except Exception as e:
        print(f"Could not download {file_id} ({mime_type}): {e}")
        return None


def process_drive_file(file_content: bytes, mime_type: str, filename: str) -> list:
    """Process a Drive file - text, image, or PDF."""
    
    chunks = []
    
    # Case 1: Image files
    if mime_type.startswith('image/'):
        description = describe_image(file_content)
        text = format_for_search(description)
        chunks.append({
            "text": text,
            "source": f"Drive: {filename}",
            "type": "image",
            "metadata": description
        })
    
    # Case 2: PDF files - extract text AND images
    elif mime_type == 'application/pdf':
        # Extract text normally
        text_chunks = extract_text_from_pdf(file_content)
        chunks.extend(text_chunks)
        
        # Extract and analyze images from PDF
        try:
            images = extract_images_from_pdf(file_content)
            for idx, img_bytes in enumerate(images):
                description = describe_image(img_bytes)
                text = format_for_search(description)
                chunks.append({
                    "text": text,
                    "source": f"Drive: {filename} (image {idx+1})",
                    "type": "pdf_image",
                    "metadata": description
                })
        except Exception as e:
            print(f"[Drive] Could not extract images from PDF: {e}")
    
    # Case 3: Regular text files
    else:
        text_chunks = extract_text_from_file(file_content)
        chunks.extend(text_chunks)
    
    return chunks


def extract_images_from_pdf(pdf_bytes: bytes) -> list:
    """Extract images from a PDF file."""
    try:
        from pdf2image import convert_from_bytes
        
        images = convert_from_bytes(pdf_bytes, dpi=150, first_page=1, last_page=10)
        image_bytes_list = []
        
        for img in images:
            img_byte_arr = io.BytesIO()
            img.save(img_byte_arr, format='PNG')
            image_bytes_list.append(img_byte_arr.getvalue())
        
        return image_bytes_list
    except Exception as e:
        print(f"[PDF] Error extracting images: {e}")
        return []


def extract_text_from_pdf(pdf_bytes: bytes) -> list:
    """Extract text from PDF (your existing implementation)."""
    # Use your existing PDF text extraction
    # This is a placeholder - use PyPDF2, pdfplumber, etc.
    try:
        import pdfplumber
        chunks = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            full_text = ""
            for page in pdf.pages:
                full_text += page.extract_text() or ""
            
            # Chunk the text
            chunks = chunk_text(full_text)
            return [{"text": c, "source": "PDF document", "type": "text"} for c in chunks]
    except Exception as e:
        print(f"[PDF] Text extraction error: {e}")
        return []


def extract_text_from_file(content: bytes) -> list:
    """Extract text from plain text file."""
    text = content.decode('utf-8', errors='ignore')
    chunks = chunk_text(text)
    return [{"text": c, "source": "Document", "type": "text"} for c in chunks]


def chunk_text(text: str, chunk_size: int = 800) -> list:
    """Split text into chunks."""
    chunks = []
    for i in range(0, len(text), chunk_size):
        chunks.append(text[i:i + chunk_size])
    return chunks


def chunk_drive_files(files: list):
    chunks = []
    for f in files:
        file_chunks = process_drive_file(f['content'], f['mimeType'], f['name'])
        chunks.extend(file_chunks)
    return chunks
