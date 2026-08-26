"use client";

import { useState } from "react";
import type { Finding } from "@/model/validate";
import { Banner } from "./Banner";
import { tooltip } from "./tooltips";

/**
 * Identity of one finding. Several findings share a code and a period (one per
 * subtotal, one per conflicting cell, one per missing statement), so the keys
 * they carry are what tells them apart. Dismissing one must not hide its siblings.
 */
export const findingId = (f: Finding) => `${f.code}:${f.periodKey}:${f.keys.join(",")}`;

interface Props {
  findings: Finding[];
}

/**
 * The stack of finding banners, shared by the workspace screen and the forecast tab.
 *
 * One component rather than two call sites with their own copy of the dismissal rule,
 * because the two lists have different severities in them: M1's validation gate emits
 * only `blocking` and `warning`, while the forecast engine also emits `info`
 * (`forecast_driver_default`). The dismissal rule was widened for `info` long before
 * anything `info` was ever rendered, so the branch existed with nothing able to reach
 * it. Rendering both lists through here is what makes it reachable.
 */
export function FindingList({ findings }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = findings.filter((f) => !dismissed.has(findingId(f)));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {visible.map((f) => (
        <Banner
          key={findingId(f)}
          severity={f.severity}
          title={f.message}
          titleHelp={tooltip(`finding.${f.code}`)}
          remediation={f.remediation}
          // Only a blocking finding is undismissable: it means the figures are not
          // safe to read. Warning and info are both, by definition, things the user
          // may act on and move past.
          onDismiss={f.severity !== "blocking"
            ? () => setDismissed((prev) => new Set(prev).add(findingId(f)))
            : undefined}
        />
      ))}
    </div>
  );
}
