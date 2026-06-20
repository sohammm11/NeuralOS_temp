from app.workflows import create_notion_task, send_slack_message
from app.feedback import get_relevant_corrections
from app.database import create_pending_action
import json

def plan_steps(instruction: str, llm, context: str):
    """
    Uses Gemini to break instruction into executable steps.
    """
    planning_prompt = f"""
You are NeuralOS Agent Planner. Break the following instruction into steps.
Each step must be one of these action types:
- QUERY: Search company knowledge for information
- CREATE_TASK: Create a Notion task
- SEND_SLACK: Send a Slack message
- SUMMARIZE: Summarize findings

Return ONLY a JSON array of steps like this:
[
  {{"step": 1, "type": "QUERY", "instruction": "what to search for"}},
  {{"step": 2, "type": "CREATE_TASK", "instruction": "task details"}},
  {{"step": 3, "type": "SEND_SLACK", "instruction": "message to send"}}
]

Company context:
{context}

Instruction: {instruction}

Return only valid JSON, no explanation.
"""
    response = llm.invoke(planning_prompt)
    content = response.content.strip()

    # Clean JSON
    if "```json" in content:
        content = content.split("```json")[1].split("```")[0].strip()
    elif "```" in content:
        content = content.split("```")[1].split("```")[0].strip()

    try:
        steps = json.loads(content)
        return steps
    except:
        return [{"step": 1, "type": "QUERY", "instruction": instruction}]


async def execute_agent(
    instruction: str,
    llm,
    embeddings,
    index,
    notion_token: str = None,
    slack_token: str = None,
    company_id: str = "demo"
):
    """
    Main agent execution loop.
    """
    results = []
    context_so_far = ""

    # Step 1: Get initial context from RAG
    try:
        query_vector = embeddings.embed_query(instruction)
        search_response = index.query(
            vector=query_vector,
            top_k=5,
            include_metadata=True
        )
        context_chunks = []
        for match in search_response.matches:
            text = match.metadata.get("text", "")
            if text:
                context_chunks.append(text)
        context_so_far = "\n\n".join(context_chunks)
    except Exception as e:
        context_so_far = f"Error fetching context: {e}"

    # Step 2: Plan steps
    yield {"type": "status", "content": "🧠 Planning steps..."}
    steps = plan_steps(instruction, llm, context_so_far[:2000])
    yield {"type": "status", "content": f"📋 Found {len(steps)} steps to execute"}

    # Step 3: Execute each step
    for step in steps:
        step_type = step.get("type", "QUERY")
        step_instruction = step.get("instruction", "")
        step_num = step.get("step", 0)

        yield {
            "type": "step",
            "content": f"Step {step_num}: {step_type} — {step_instruction}"
        }

        if step_type == "QUERY":
            try:
                query_vector = embeddings.embed_query(step_instruction)
                search_response = index.query(
                    vector=query_vector,
                    top_k=3,
                    include_metadata=True
                )
                chunks = []
                for match in search_response.matches:
                    text = match.metadata.get("text", "")
                    if text:
                        chunks.append(text)

                query_context = "\n\n".join(chunks)
                summary_prompt = (
                    f"Based on this context, answer: {step_instruction}\n\n"
                    f"Context: {query_context}\n\n"
                    f"Answer concisely:"
                )
                response = llm.invoke(summary_prompt)
                result = response.content
                context_so_far += f"\n\n{result}"
                results.append({
                    "step": step_num,
                    "type": step_type,
                    "result": result
                })
                yield {"type": "result", "content": result}

            except Exception as e:
                yield {"type": "error", "content": f"Query failed: {e}"}

        elif step_type == "CREATE_TASK" and notion_token:
            try:
                # Extract task details from context
                task_prompt = (
                    f"Based on this instruction: '{step_instruction}'\n"
                    f"And this context: {context_so_far[:1000]}\n"
                    f"What is the task title and who should it be assigned to?\n"
                    f"Reply in format: TITLE: <title> | ASSIGNEE: <name>"
                )
                response = llm.invoke(task_prompt)
                content = response.content

                title = step_instruction
                assignee = None

                if "TITLE:" in content:
                    title = content.split("TITLE:")[1].split("|")[0].strip()
                if "ASSIGNEE:" in content:
                    assignee = content.split("ASSIGNEE:")[1].strip()

                action_id = create_pending_action(
                    company_id=company_id,
                    action_type="CREATE_TASK",
                    details={
                        "title": title,
                        "assignee": assignee,
                        "notes": context_so_far[:500],
                        "notion_token": notion_token
                    }
                )
                yield {
                    "type": "approval_needed",
                    "content": f"NeuralOS wants to create this task:\n\nTitle: {title}\nAssignee: {assignee or 'Unassigned'}\n\nApprove this action in the Workflows tab before it's created.",
                    "action_id": action_id
                }
                results.append({
                    "step": step_num,
                    "type": step_type,
                    "result": "Pending approval"
                })

            except Exception as e:
                yield {"type": "error", "content": f"Task creation failed: {e}"}

        elif step_type == "SEND_SLACK" and slack_token:
            try:
                msg_prompt = (
                    f"Write a brief Slack message for: {step_instruction}\n"
                    f"Based on: {context_so_far[:500]}\n"
                    f"Keep it under 100 words. Start with [NeuralOS]:"
                )
                response = llm.invoke(msg_prompt)
                message = response.content

                # Guardrail: flag for approval instead of auto-sending
                action_id = create_pending_action(
                    company_id=company_id,
                    action_type="SEND_SLACK",
                    details={
                        "channel": "general",
                        "message": message,
                        "slack_token": slack_token
                    }
                )
                yield {
                    "type": "approval_needed",
                    "content": f"NeuralOS wants to send this Slack message:\n\n{message}\n\nApprove this action in the Workflows tab before it sends.",
                    "action_id": action_id
                }
                results.append({
                    "step": step_num,
                    "type": step_type,
                    "result": "Pending approval"
                })

            except Exception as e:
                yield {"type": "error", "content": f"Slack message draft failed: {e}"}

        elif step_type == "SUMMARIZE":
            try:
                summary_prompt = (
                    f"Summarize everything done so far:\n"
                    f"{context_so_far[:2000]}\n\n"
                    f"Be concise and actionable."
                )
                response = llm.invoke(summary_prompt)
                result = response.content
                results.append({
                    "step": step_num,
                    "type": step_type,
                    "result": result
                })
                yield {"type": "result", "content": result}

            except Exception as e:
                yield {"type": "error", "content": f"Summarize failed: {e}"}

    # Final summary
    yield {"type": "done", "content": f"✅ Agent completed {len(steps)} steps."}