import type { ReactNode } from "react";
import { buildWhatsappUrl } from "@/lib/site-settings/whatsapp";

interface WhatsAppLinkProps {
  /**
   * The atelier's number from the site settings (`SiteSettings.whatsappNumber`).
   * Unset or unusable renders nothing at all, so callers never branch on it.
   */
  number: string | null | undefined;
  /** Pre-filled chat text, already localized. Percent-encoded here. */
  message: string;
  className?: string;
  children: ReactNode;
}

// The one place that renders the WhatsApp call to action (checkout success,
// contact page, cart footer), so the rules cannot drift between them: no valid
// number means no link, the URL is built only from digits plus an encoded text,
// and the link opens WhatsApp in a new tab without handing it `window.opener`
// or a referrer. A plain element with no hooks, so it works in Server Components
// and in CartDrawer alike.
export function WhatsAppLink({
  number,
  message,
  className,
  children,
}: WhatsAppLinkProps) {
  const href = buildWhatsappUrl(number, message);
  if (!href) {
    return null;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}
