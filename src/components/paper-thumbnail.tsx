"use client";

import Image from "next/image";
import { useState } from "react";

export function PaperThumbnail({ documentId, enabled }: { documentId: number; enabled: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div className="paper-thumbnail" aria-hidden="true">
    <span className="thumbnail-rule" /><span /><span /><span /><i>∑</i><span /><span />
    {enabled && !failed && <Image className="paper-thumbnail-image"
      src={`/api/documents/${documentId}/thumbnail`} alt="" fill unoptimized
      loading="lazy" fetchPriority="low" decoding="async" onError={() => setFailed(true)} />}
  </div>;
}
