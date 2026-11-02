"""Tool definitions for all AI Assistant connectors."""

from __future__ import annotations

from app.tools.shared.contracts import ToolDefinition

# ── 1. OCR & Document Intelligence ──────────────────────────────────────────

ANALYZE_DOCUMENT_TOOL = ToolDefinition(
    name="hiring.analyze_document",
    description=(
        "Extract and analyze text content from an uploaded document (PDF, image, "
        "Word, Excel, CSV, PowerPoint, or text file). Returns extracted text and "
        "structured data when applicable. Use this when the employer uploads a file "
        "and you need to understand its contents for job drafting or candidate matching."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "file_key": {
                "type": "string",
                "description": "Storage key of the uploaded file to analyze.",
            },
            "analysis_intent": {
                "type": "string",
                "enum": ["job_requirements", "worker_list", "salary_data", "general"],
                "description": "What kind of information to extract from the document.",
            },
        },
        "required": ["file_key", "analysis_intent"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "extracted_text": {"type": "string"},
            "structured_data": {"type": "object"},
            "document_type": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": ["extracted_text", "document_type"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
)

# ── 2. Spreadsheet Parsing ──────────────────────────────────────────────────

PARSE_SPREADSHEET_TOOL = ToolDefinition(
    name="hiring.parse_spreadsheet",
    description=(
        "Parse an uploaded Excel (.xlsx/.xls), CSV, or Google Sheets-exported file. "
        "Returns structured row data suitable for bulk job creation or worker data import. "
        "Use this when the employer uploads a spreadsheet with job requirements, worker lists, "
        "or salary structures."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "file_key": {
                "type": "string",
                "description": "Storage key of the uploaded spreadsheet file.",
            },
            "sheet_name": {
                "type": "string",
                "description": "Specific sheet name to read (Excel only). Reads first sheet if omitted.",
            },
            "max_rows": {
                "type": "integer",
                "minimum": 1,
                "maximum": 500,
                "description": "Maximum rows to return. Defaults to 100.",
            },
        },
        "required": ["file_key"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "headers": {"type": "array", "items": {"type": "string"}},
            "rows": {"type": "array", "items": {"type": "array"}},
            "total_rows": {"type": "integer"},
            "truncated": {"type": "boolean"},
            "sheet_name": {"type": "string"},
        },
        "required": ["headers", "rows", "total_rows", "truncated"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
)

# ── 3a. Gmail Read ─────────────────────────────────────────────────────────

LIST_EMAILS_TOOL = ToolDefinition(
    name="hiring.list_emails",
    description=(
        "List recent emails from the employer's connected Gmail inbox. Can optionally "
        "search by query (same syntax as Gmail search: from:, subject:, is:unread, etc.). "
        "Returns subject, sender, date and snippet for each email. Use when the employer "
        "asks to check their email, find a specific message, or see recent communications."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "maxLength": 200,
                "description": "Gmail search query (e.g., 'from:hr@company.com', 'is:unread', 'subject:invoice'). Omit to list recent emails.",
            },
            "max_results": {
                "type": "integer",
                "minimum": 1,
                "maximum": 10,
                "description": "Number of emails to return (default 5, max 10).",
            },
        },
        "required": [],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "emails": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "message_id": {"type": "string"},
                        "from": {"type": "string"},
                        "to": {"type": "string"},
                        "subject": {"type": "string"},
                        "date": {"type": "string"},
                        "snippet": {"type": "string"},
                    },
                },
            },
            "total_estimate": {"type": "integer"},
        },
        "required": ["emails"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
)

READ_EMAIL_TOOL = ToolDefinition(
    name="hiring.read_email",
    description=(
        "Read the full content of a specific email by its message ID. Use after listing "
        "emails to read the complete body of a particular message the employer is "
        "interested in. Returns the full email body along with metadata."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "message_id": {
                "type": "string",
                "description": "Gmail message ID (obtained from list_emails results).",
            },
        },
        "required": ["message_id"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "message_id": {"type": "string"},
            "from": {"type": "string"},
            "to": {"type": "string"},
            "subject": {"type": "string"},
            "date": {"type": "string"},
            "body": {"type": "string"},
            "labels": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["message_id"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
)

# ── 3b. Email Send (via Resend) ────────────────────────────────────────────

SEND_EMAIL_TOOL = ToolDefinition(
    name="hiring.send_email",
    description=(
        "Send a professional email on behalf of the employer. Use for sending job offers, "
        "interview invitations, onboarding documents, or formal communications to candidates "
        "or team members. The employer must confirm the recipient and content before sending."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "to": {
                "type": "string",
                "description": "Recipient email address.",
            },
            "subject": {
                "type": "string",
                "maxLength": 200,
                "description": "Email subject line.",
            },
            "body": {
                "type": "string",
                "maxLength": 5000,
                "description": "Email body in plain text.",
            },
            "purpose": {
                "type": "string",
                "enum": ["job_offer", "interview_invite", "onboarding", "notification", "follow_up"],
                "description": "Purpose of the email for tracking.",
            },
        },
        "required": ["to", "subject", "body", "purpose"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "sent": {"type": "boolean"},
            "email_id": {"type": "string"},
            "recipient": {"type": "string"},
        },
        "required": ["sent"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
    confirmation_required=True,
)

# ── 4. WhatsApp (via MSG91) ─────────────────────────────────────────────────

SEND_WHATSAPP_TOOL = ToolDefinition(
    name="hiring.send_whatsapp",
    description=(
        "Send a WhatsApp message to a candidate or worker. Use for job notifications, "
        "interview reminders, status updates, or quick communication. Requires a valid "
        "Indian mobile number. The employer must confirm the message before sending."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "phone": {
                "type": "string",
                "description": "Recipient phone number with country code (e.g., 91XXXXXXXXXX).",
            },
            "message": {
                "type": "string",
                "maxLength": 1000,
                "description": "Message text to send.",
            },
            "template_name": {
                "type": "string",
                "description": "Pre-approved WhatsApp template name. Required for initiating conversations.",
            },
        },
        "required": ["phone", "message"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "sent": {"type": "boolean"},
            "message_id": {"type": "string"},
        },
        "required": ["sent"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
    confirmation_required=True,
)

# ── 5. Google Calendar ──────────────────────────────────────────────────────

SCHEDULE_EVENT_TOOL = ToolDefinition(
    name="hiring.schedule_event",
    description=(
        "Create a calendar event for interviews, site visits, or meetings. "
        "Generates a Google Calendar event with optional Zoom/Meet link. "
        "Use when the employer wants to schedule time with candidates or team members."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "maxLength": 200,
                "description": "Event title (e.g., 'Interview — Mason Position').",
            },
            "start_time": {
                "type": "string",
                "description": "Start time in ISO 8601 format.",
            },
            "duration_minutes": {
                "type": "integer",
                "minimum": 15,
                "maximum": 480,
                "description": "Duration in minutes.",
            },
            "attendees": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 20,
                "description": "List of attendee email addresses.",
            },
            "location": {
                "type": "string",
                "maxLength": 300,
                "description": "Physical location or 'virtual' for online meeting.",
            },
            "description": {
                "type": "string",
                "maxLength": 2000,
                "description": "Event description with details.",
            },
            "add_video_meeting": {
                "type": "boolean",
                "description": "Whether to attach a Google Meet / Zoom link.",
            },
        },
        "required": ["title", "start_time", "duration_minutes"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "created": {"type": "boolean"},
            "event_id": {"type": "string"},
            "event_link": {"type": "string"},
            "meeting_link": {"type": "string"},
        },
        "required": ["created"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
    confirmation_required=True,
)

# ── 6. Google Drive / Docs ──────────────────────────────────────────────────

FETCH_DRIVE_FILE_TOOL = ToolDefinition(
    name="hiring.fetch_drive_file",
    description=(
        "Fetch and read a file from Google Drive. Use to retrieve job description templates, "
        "company policies, compliance documents, or any file the employer references by URL or name."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "file_url": {
                "type": "string",
                "description": "Google Drive file URL or file ID.",
            },
            "extract_text": {
                "type": "boolean",
                "description": "Whether to extract plain text content (default true).",
            },
        },
        "required": ["file_url"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "file_name": {"type": "string"},
            "mime_type": {"type": "string"},
            "content": {"type": "string"},
            "size_bytes": {"type": "integer"},
        },
        "required": ["file_name", "mime_type"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
)

# ── 7. Google Forms ─────────────────────────────────────────────────────────

CREATE_FORM_TOOL = ToolDefinition(
    name="hiring.create_application_form",
    description=(
        "Create a Google Form for job applications. Generates a form with appropriate "
        "questions based on job requirements (experience, skills, availability, contact info). "
        "Returns a shareable form link."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "job_title": {
                "type": "string",
                "description": "Job title for the form header.",
            },
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "type": {"type": "string", "enum": ["text", "number", "choice", "date"]},
                        "required": {"type": "boolean"},
                        "options": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["text", "type"],
                },
                "maxItems": 20,
                "description": "Form questions to include.",
            },
            "collect_email": {
                "type": "boolean",
                "description": "Whether to collect respondent email addresses.",
            },
        },
        "required": ["job_title", "questions"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "created": {"type": "boolean"},
            "form_id": {"type": "string"},
            "form_url": {"type": "string"},
            "edit_url": {"type": "string"},
        },
        "required": ["created"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
    confirmation_required=True,
)

# ── 8. LinkedIn ─────────────────────────────────────────────────────────────

LOOKUP_LINKEDIN_TOOL = ToolDefinition(
    name="hiring.lookup_linkedin",
    description=(
        "Look up a candidate's LinkedIn profile to enrich their data with work history, "
        "skills, and endorsements. Use for semi-skilled or skilled positions where "
        "professional background is relevant."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "profile_url": {
                "type": "string",
                "description": "LinkedIn profile URL.",
            },
            "name": {
                "type": "string",
                "description": "Candidate name for search if URL is not available.",
            },
        },
        "required": [],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "found": {"type": "boolean"},
            "name": {"type": "string"},
            "headline": {"type": "string"},
            "experience": {"type": "array", "items": {"type": "object"}},
            "skills": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["found"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
)

# ── 9. GitHub Portfolio ─────────────────────────────────────────────────────

FETCH_GITHUB_PORTFOLIO_TOOL = ToolDefinition(
    name="hiring.fetch_github_portfolio",
    description=(
        "Retrieve a candidate's GitHub profile and repository summary. Shows public "
        "repositories, languages used, contribution activity, and README content. "
        "Use for technical roles to assess coding ability."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "username": {
                "type": "string",
                "description": "GitHub username.",
            },
        },
        "required": ["username"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "found": {"type": "boolean"},
            "name": {"type": "string"},
            "bio": {"type": "string"},
            "public_repos": {"type": "integer"},
            "top_languages": {"type": "array", "items": {"type": "string"}},
            "repositories": {"type": "array", "items": {"type": "object"}},
        },
        "required": ["found"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
)

# ── 10. TallyPrime ─────────────────────────────────────────────────────────

FETCH_TALLY_DATA_TOOL = ToolDefinition(
    name="hiring.fetch_tally_data",
    description=(
        "Fetch financial data from TallyPrime for budget validation. Retrieves salary budgets, "
        "contractor payment history, or ledger balances. Use when the employer needs to verify "
        "wage budgets or payment capacity for job creation."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "query_type": {
                "type": "string",
                "enum": ["salary_budget", "payment_history", "ledger_balance"],
                "description": "Type of financial data to retrieve.",
            },
            "company_name": {
                "type": "string",
                "description": "TallyPrime company name.",
            },
            "date_from": {
                "type": "string",
                "description": "Start date (YYYY-MM-DD).",
            },
            "date_to": {
                "type": "string",
                "description": "End date (YYYY-MM-DD).",
            },
        },
        "required": ["query_type"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "success": {"type": "boolean"},
            "data": {"type": "object"},
            "summary": {"type": "string"},
        },
        "required": ["success"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
)

# ── 11. Slack ───────────────────────────────────────────────────────────────

SEND_SLACK_MESSAGE_TOOL = ToolDefinition(
    name="hiring.send_slack_message",
    description=(
        "Send a notification to a Slack channel or user. Use for team updates about "
        "new candidates, job status changes, or hiring milestones."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "channel": {
                "type": "string",
                "description": "Slack channel name (e.g., #hiring) or user ID.",
            },
            "message": {
                "type": "string",
                "maxLength": 3000,
                "description": "Message text (supports Slack markdown).",
            },
        },
        "required": ["channel", "message"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "sent": {"type": "boolean"},
            "timestamp": {"type": "string"},
            "channel": {"type": "string"},
        },
        "required": ["sent"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
    confirmation_required=True,
)

# ── 12. Microsoft Teams ────────────────────────────────────────────────────

SEND_TEAMS_MESSAGE_TOOL = ToolDefinition(
    name="hiring.send_teams_message",
    description=(
        "Send a notification to a Microsoft Teams channel. Use for team updates about "
        "hiring progress, new candidate matches, or interview schedules."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "webhook_url": {
                "type": "string",
                "description": "Teams incoming webhook URL for the target channel.",
            },
            "title": {
                "type": "string",
                "maxLength": 200,
                "description": "Message card title.",
            },
            "message": {
                "type": "string",
                "maxLength": 3000,
                "description": "Message body text.",
            },
        },
        "required": ["webhook_url", "title", "message"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "sent": {"type": "boolean"},
        },
        "required": ["sent"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
    confirmation_required=True,
)

# ── 13. Social Media (Instagram / Facebook) ─────────────────────────────────

POST_SOCIAL_MEDIA_TOOL = ToolDefinition(
    name="hiring.post_social_media",
    description=(
        "Post a job listing to Instagram or Facebook. Creates a formatted post with "
        "job details for social media distribution. Use when the employer wants to "
        "share job openings on their social channels."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "platform": {
                "type": "string",
                "enum": ["instagram", "facebook"],
                "description": "Target social media platform.",
            },
            "caption": {
                "type": "string",
                "maxLength": 2200,
                "description": "Post caption/text.",
            },
            "job_title": {
                "type": "string",
                "description": "Job title for the post.",
            },
            "location": {
                "type": "string",
                "description": "Job location for the post.",
            },
            "hashtags": {
                "type": "array",
                "items": {"type": "string"},
                "maxItems": 30,
                "description": "Hashtags to include.",
            },
        },
        "required": ["platform", "caption", "job_title"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "posted": {"type": "boolean"},
            "post_id": {"type": "string"},
            "post_url": {"type": "string"},
        },
        "required": ["posted"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
    confirmation_required=True,
)

# ── 14. Zoom ────────────────────────────────────────────────────────────────

CREATE_ZOOM_MEETING_TOOL = ToolDefinition(
    name="hiring.create_zoom_meeting",
    description=(
        "Create a Zoom meeting for interviews or team discussions. Returns a meeting "
        "link that can be shared with candidates. Use alongside calendar events for "
        "virtual interviews."
    ),
    domain="hiring",
    agent_id="hiring",
    input_schema={
        "type": "object",
        "properties": {
            "topic": {
                "type": "string",
                "maxLength": 200,
                "description": "Meeting topic/title.",
            },
            "start_time": {
                "type": "string",
                "description": "Start time in ISO 8601 format.",
            },
            "duration_minutes": {
                "type": "integer",
                "minimum": 15,
                "maximum": 480,
                "description": "Duration in minutes.",
            },
            "password": {
                "type": "string",
                "maxLength": 10,
                "description": "Optional meeting password.",
            },
        },
        "required": ["topic", "start_time", "duration_minutes"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "created": {"type": "boolean"},
            "meeting_id": {"type": "string"},
            "join_url": {"type": "string"},
            "password": {"type": "string"},
        },
        "required": ["created"],
    },
    required_roles=("EMPLOYER",),
    required_permissions=("assistant:message",),
    confirmation_required=True,
)
