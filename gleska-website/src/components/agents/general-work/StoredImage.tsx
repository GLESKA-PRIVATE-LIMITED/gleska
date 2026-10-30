"use client";

import React, { useState } from "react";

/** Image from a short-lived signed URL; shows `fallback` if the URL is missing or has expired. */
export default function StoredImage({
  src,
  alt,
  className,
  fallback,
}: {
  src: string | null;
  alt: string;
  className?: string;
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs are not served through next/image
    <img src={src} alt={alt} loading="lazy" className={className} onError={() => setFailed(true)} />
  );
}
