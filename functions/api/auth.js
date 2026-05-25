// Cloudflare Pages Function for OAuth Authorization
// Triggers redirect to GitHub OAuth login page.
// Expects GITHUB_CLIENT_ID environment variable to be set in Cloudflare dashboard.

export async function onRequestGet(context) {
  const { env } = context;
  const clientId = env.GITHUB_CLIENT_ID;
  
  if (!clientId) {
    return new Response(
      JSON.stringify({ error: "Missing GITHUB_CLIENT_ID environment variable on Cloudflare Pages." }), 
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
  
  const oauthUrl = new URL("https://github.com/login/oauth/authorize");
  oauthUrl.searchParams.set("client_id", clientId);
  oauthUrl.searchParams.set("scope", "repo,user");
  
  return Response.redirect(oauthUrl.toString(), 307);
}
