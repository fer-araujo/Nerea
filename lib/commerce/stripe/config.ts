// Whether online payments are switched on. Deliberately a module of its own
// with NO Stripe SDK import: the locale layout and the checkout action only
// need the yes/no answer, and importing client.ts for it would drag the SDK
// into code that never talks to Stripe. It reads the same variable as
// getStripeClient (client.ts), so "configured" means exactly what that
// function means by it.
//
// Payments stay off until the jeweler's Stripe account is activated and the
// key is set: the cart then offers "reserve by message" instead of a checkout
// button (CartDrawer.tsx), and checkoutAction refuses without touching Sanity
// or Stripe. Setting STRIPE_SECRET_KEY and redeploying lifts the gate, with no
// code change. A redeploy is needed because the layout reads this at build
// time for the pages it prerenders.
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
