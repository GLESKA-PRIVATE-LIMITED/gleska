"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cleanupMSG91Widget } from "@/lib/msg91";

export default function MSG91Cleanup() {
  const pathname = usePathname();
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (prevPathname.current !== pathname) {
      cleanupMSG91Widget();
      prevPathname.current = pathname;
    }
  }, [pathname]);

  return null;
}
