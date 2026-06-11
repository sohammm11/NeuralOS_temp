import json
import os
from datetime import datetime

FEEDBACK_FILE = os.path.join(os.path.dirname(__file__), '..', 'feedback_store.json')

def load_feedback():
    if os.path.exists(FEEDBACK_FILE):
        with open(FEEDBACK_FILE, 'r') as f:
            return json.load(f)
    return {"corrections": [], "good_answers": []}

def save_feedback(data):
    with open(FEEDBACK_FILE, 'w') as f:
        json.dump(data, f, indent=2)

def add_correction(question: str, bad_answer: str, correction: str):
    data = load_feedback()
    data["corrections"].append({
        "question": question,
        "bad_answer": bad_answer,
        "correction": correction,
        "timestamp": datetime.now().isoformat()
    })
    save_feedback(data)
    return True

def add_good_answer(question: str, answer: str):
    data = load_feedback()
    data["good_answers"].append({
        "question": question,
        "answer": answer,
        "timestamp": datetime.now().isoformat()
    })
    save_feedback(data)
    return True

def get_relevant_corrections(question: str):
    """
    Returns corrections relevant to the current question.
    Simple keyword matching for now.
    """
    data = load_feedback()
    corrections = data.get("corrections", [])

    relevant = []
    question_words = set(question.lower().split())

    for correction in corrections:
        stored_words = set(correction["question"].lower().split())
        overlap = question_words & stored_words
        if len(overlap) >= 2:
            relevant.append(correction)

    return relevant[-5:] if relevant else []

def get_feedback_stats():
    data = load_feedback()
    return {
        "total_corrections": len(data.get("corrections", [])),
        "total_good_answers": len(data.get("good_answers", [])),
    }
