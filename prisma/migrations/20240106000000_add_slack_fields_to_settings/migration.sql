-- Add Slack OAuth integration fields to the settings table.
-- slack_access_token stores the OAuth access token (null = not connected).
-- slack_workspace_name stores the human-readable workspace name shown in the UI.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "slack_access_token"   TEXT,
  ADD COLUMN IF NOT EXISTS "slack_workspace_name"  TEXT;
