import { Fraunces, Space_Grotesk, JetBrains_Mono } from "next/font/google";

// Shared by BOTH root layouts — the storefront (app/[locale]/layout.tsx) and
// the admin panel (app/admin/layout.tsx). Each root layout owns its own
// <html>/<body>, so each has to attach the font CSS variables itself; defining
// the fonts once here keeps the two shells on the exact same typography (the
// tokens in app/globals.css reference these variables) instead of two copies
// drifting apart.

// Display — Fraunces (optical, warm serif). Brief-mandated: the client named a
// serif for the atelier/gallery identity, so the usual "no default serif" guard
// doesn't apply here. `opsz` axis lets headings pick up optical warmth.
export const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-fraunces",
  display: "swap",
});

// Body / UI — Space Grotesk. A clean grotesque with more architectural
// character than Inter; carries the MCM "precision" side of the synthesis.
export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

// Data — JetBrains Mono. Drives the signature spec-plates and prices.
export const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

// The three variable classes, joined once, for the <html> element of each
// root layout.
export const fontVariables = `${fraunces.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable}`;
