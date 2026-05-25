// Cloudflare Pages Function for OAuth Callback
// Receives authorization code from GitHub, exchanges it for an access token,
// and sends it to the opener window using postMessage.

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  
  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }
  
  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Astro-MicroSaaS-App"
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code
      })
    });
    
    const data = await tokenResponse.json();
    
    if (data.error) {
      return new Response(JSON.stringify(data), { 
        status: 400, 
        headers: { "Content-Type": "application/json" } 
      });
    }
    
    // HTML wrapper that posts the access token back to Sveltia CMS
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Authorizing...</title>
</head>
<body>
  <p>Authorization successful. Transferring session to CMS...</p>
  <script>
    (function() {
      const token = ${JSON.stringify(data.access_token)};
      const provider = "github";
      const payload = { token: token, provider: provider };
      const message = "authorization:" + provider + ":success:" + JSON.stringify(payload);
      
      // Send the token back to the CMS editor window
      window.opener.postMessage(message, window.location.origin);
    })();
  </script>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  } catch (error) {
    return new Response("Token exchange failed: " + error.message, { status: 500 });
  }
}
