import { defineCliConfig } from "sanity/cli";
import { dataset, projectId } from "./sanity/env";

// Config for the Sanity CLI (`npx sanity login`, `npx sanity deploy`). It lets
// the Studio be published to Sanity's own hosting, so the jeweler's day-to-day
// editing never runs through the storefront's host. The embedded /studio route
// (app/studio) keeps working as it is; this only adds the hosted copy.
//
// `studioHost` is the hostname `sanity deploy` claims on its first run:
// https://nerea.sanity.studio. It is deprecated in favor of
// `deployment.appId`; once the first deploy prints the app ID, it can be
// pinned here too (see README.md).
export default defineCliConfig({
  api: { projectId, dataset },
  studioHost: "nerea",
});
