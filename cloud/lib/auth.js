export function agentAuthorized(request) {
  const secret = process.env.AGENT_SECRET;
  return Boolean(secret) && request.headers.get("x-agent-secret") === secret;
}
