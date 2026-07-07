import re

# PII patterns
PATTERNS = {
    "email": r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
    "phone": r'\b(?:\+91|0)?[6-9]\d{9}\b',
    "aadhaar": r'\b\d{4}\s\d{4}\s\d{4}\b',
    "pan": r'\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b',
    "credit_card": r'\b(?:\d{4}[\s-]?){3}\d{4}\b',
    "ssn": r'\b\d{3}-\d{2}-\d{4}\b',
}

def detect_pii(text: str) -> dict:
    """
    Scans text for PII. Returns findings dict.
    """
    findings = {}
    for pii_type, pattern in PATTERNS.items():
        matches = re.findall(pattern, text)
        if matches:
            findings[pii_type] = matches
    return findings

def redact_pii(text: str) -> tuple:
    """
    Redacts PII from text. Returns (redacted_text, findings).
    """
    findings = detect_pii(text)
    redacted = text

    for pii_type, pattern in PATTERNS.items():
        redacted = re.sub(pattern, f'[{pii_type.upper()} REDACTED]', redacted)

    return redacted, findings

def scan_chunks(chunks: list) -> tuple:
    """
    Scans all chunks before indexing.
    Returns safe chunks with PII redacted + report.
    """
    safe_chunks = []
    pii_report = {
        "total_chunks": len(chunks),
        "chunks_with_pii": 0,
        "findings": {}
    }

    for chunk in chunks:
        text = chunk.get("text", "")
        redacted_text, findings = redact_pii(text)

        if findings:
            pii_report["chunks_with_pii"] += 1
            for pii_type, matches in findings.items():
                if pii_type not in pii_report["findings"]:
                    pii_report["findings"][pii_type] = 0
                pii_report["findings"][pii_type] += len(matches)

        safe_chunk = {**chunk, "text": redacted_text}
        safe_chunks.append(safe_chunk)

    return safe_chunks, pii_report
