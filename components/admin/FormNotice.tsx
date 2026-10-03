import type { ActionResult } from "@/lib/admin/action-result";
import { NOTICE_ERROR_CLASS, NOTICE_INFO_CLASS } from "./styles";

// The outcome of a form submission, announced to assistive tech: a failure is
// an alert (it interrupts), a success a polite status. Renders nothing before
// anything was attempted. The failure text comes from the typed result — a
// fixed Spanish sentence, never an error from the server's internals.
//
// A success may carry a warning (the action worked, but something near it
// needs the admin's attention): that one is an alert too, shown right under
// the confirmation, so it can't be missed.
export function FormNotice({
  result,
  successText,
}: {
  result: ActionResult | null;
  successText: string;
}) {
  if (!result) {
    return null;
  }

  if (!result.ok) {
    return (
      <p role="alert" className={NOTICE_ERROR_CLASS}>
        {result.message}
      </p>
    );
  }

  return (
    <>
      <p role="status" className={NOTICE_INFO_CLASS}>
        {successText}
      </p>
      {result.warning ? (
        <p role="alert" className={NOTICE_ERROR_CLASS}>
          {result.warning.message}
        </p>
      ) : null}
    </>
  );
}
