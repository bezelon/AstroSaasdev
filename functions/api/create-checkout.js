// Cloudflare Pages Function for Stripe Checkout
// Creates a Stripe Checkout session and returns the session URL.
// Expects STRIPE_SECRET_KEY environment variable to be set in Cloudflare dashboard.

export async function onRequestPost(context) {
  const { request, env } = context;
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  
  if (!stripeSecretKey) {
    return new Response(
      JSON.stringify({ error: "Missing STRIPE_SECRET_KEY environment variable on Cloudflare Pages." }), 
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
  
  // We dynamically import Stripe to prevent build issues locally if package is not installed.
  // When running on Cloudflare Pages, Stripe library will be bundled if listed in dependencies or handled.
  let Stripe;
  try {
    const stripeModule = await import("stripe");
    Stripe = stripeModule.default;
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Stripe SDK could not be loaded. Please ensure 'stripe' dependency is installed." }), 
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });
  
  try {
    const { productName, price, successUrl, cancelUrl } = await request.json();
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "gbp", // Defaulting to British Pounds for the UK market
          product_data: { 
            name: productName || "Handcrafted Natural Soap" 
          },
          unit_amount: Math.round(price * 100) // Represented in pence (e.g. £5.50 -> 550)
        },
        quantity: 1
      }],
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl
    });
    
    return new Response(
      JSON.stringify({ checkoutUrl: session.url }), 
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }), 
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
