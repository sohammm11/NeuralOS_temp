import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import app.config as config

def get_encryption_key(company_id: str) -> bytes:
    """
    Derives a unique encryption key per company using PBKDF2.
    """
    password = f"{config.ENCRYPTION_SECRET}:{company_id}".encode()
    salt = company_id[:16].ljust(16).encode()
    
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(password))
    return key

def encrypt_text(text: str, company_id: str) -> str:
    """Encrypts text for a specific company."""
    try:
        key = get_encryption_key(company_id)
        f = Fernet(key)
        encrypted = f.encrypt(text.encode())
        return encrypted.decode()
    except Exception as e:
        print(f"Encryption failed: {e}")
        return text

def decrypt_text(encrypted_text: str, company_id: str) -> str:
    """Decrypts text for a specific company."""
    try:
        key = get_encryption_key(company_id)
        f = Fernet(key)
        decrypted = f.decrypt(encrypted_text.encode())
        return decrypted.decode()
    except Exception as e:
        print(f"Decryption failed: {e}")
        return encrypted_text

def encrypt_chunks(chunks: list, company_id: str) -> list:
    """Encrypts all chunk text before Pinecone storage."""
    encrypted = []
    for chunk in chunks:
        encrypted_text = encrypt_text(chunk["text"], company_id)
        encrypted.append({
            **chunk,
            "text": encrypted_text,
            "encrypted": True
        })
    return encrypted

def decrypt_chunks(matches: list, company_id: str) -> list:
    """Decrypts retrieved chunks from Pinecone."""
    decrypted = []
    for match in matches:
        text = match.metadata.get("text", "")
        is_encrypted = match.metadata.get("encrypted", False)
        
        if is_encrypted:
            text = decrypt_text(text, company_id)
        
        decrypted.append({
            "text": text,
            "source": match.metadata.get("source", "Unknown"),
            "score": match.score,
            "encrypted": is_encrypted,
            "realtime": match.metadata.get("realtime", False),
            "timestamp": match.metadata.get("timestamp", None)
        })
    return decrypted