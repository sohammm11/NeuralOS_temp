# app/meeting_prompts.py

MEETING_EXTRACTION_PROMPT = """You are an AI assistant that extracts structured information from meeting transcripts.

Analyze the following meeting transcript and extract:
1. **Decisions**: Clear decisions that were made (with context of why)
2. **Action Items**: Tasks assigned to people (with assignee, due date if mentioned, and context)
3. **Open Questions**: Unresolved questions or concerns raised
4. **Metadata**: Meeting title, date, attendees (only if explicitly mentioned)

Return ONLY valid JSON matching this exact schema:

{
  "metadata": {
    "title": "string or null",
    "date": "string or null",
    "attendees": ["name1", "name2"]
  },
  "decisions": [
    {
      "decision": "string",
      "context": "string",
      "made_by": "string or null"
    }
  ],
  "action_items": [
    {
      "task": "string",
      "assignee": "string or null",
      "due_date": "string or null",
      "context": "string"
    }
  ],
  "open_questions": [
    {
      "question": "string",
      "raised_by": "string or null",
      "context": "string"
    }
  ]
}

Rules:
- Extract only what is explicitly stated in the transcript
- For due_date, use natural language if mentioned (e.g., "December 25th", "next Monday", "Q1 2025")
- For assignee, use the person's name as mentioned (e.g., "Dev Mehta", "Ananya")
- Context should be a brief excerpt or paraphrase explaining why this item matters
- If a field is not mentioned, use null
- Be thorough but accurate - don't make up information

Meeting Transcript:
{transcript}

Return ONLY the JSON object, no additional text."""


MEETING_JSON_FIX_PROMPT = """Your previous response was not valid JSON. 

Please return ONLY a valid JSON object matching this exact schema:

{
  "metadata": {
    "title": "string or null",
    "date": "string or null",
    "attendees": ["name1", "name2"]
  },
  "decisions": [
    {
      "decision": "string",
      "context": "string",
      "made_by": "string or null"
    }
  ],
  "action_items": [
    {
      "task": "string",
      "assignee": "string or null",
      "due_date": "string or null",
      "context": "string"
    }
  ],
  "open_questions": [
    {
      "question": "string",
      "raised_by": "string or null",
      "context": "string"
    }
  ]
}

Do not include any text before or after the JSON. Just the JSON object."""
