"use client";

import { NextStudio } from "next-sanity/studio";
import config from "@/sanity.config";

// The Studio (and its config, which pulls in `sanity/structure` etc.) must
// be bundled under the client condition, not the RSC/server condition: parts
// of the `sanity` package's internals (e.g. structureTool) depend on client
// hooks that React Server Components' `swr` resolution strips out, which
// otherwise fails the build with "Export default doesn't exist" on `swr`.
export default function StudioPage() {
  return <NextStudio config={config} />;
}
