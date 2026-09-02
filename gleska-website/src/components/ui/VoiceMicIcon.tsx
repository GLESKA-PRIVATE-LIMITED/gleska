import React from "react";

export interface VoiceMicIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * Reusable Voice Microphone Icon component matching reference design.
 * Designed for use across search inputs, voice assistants, and audio controls.
 * Visually matches the Apple Siri / modern iOS voice microphone specification.
 */
export function VoiceMicIcon({ className = "w-5 h-5", ...props }: VoiceMicIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      {/* Central filled microphone capsule */}
      <rect x="9.25" y="4" width="5.5" height="9.5" rx="2.75" fill="currentColor" />
      {/* Surrounding curved U-shaped cradle */}
      <path
        d="M17 10.5V12A5 5 0 0 1 7 12V10.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Short vertical bottom stem */}
      <path
        d="M12 17V19.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default VoiceMicIcon;
