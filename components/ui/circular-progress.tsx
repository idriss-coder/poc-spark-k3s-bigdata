"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type CircularProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  size?: number
  strokeWidth?: number
}

function CircularProgress({
  className,
  size = 20,
  strokeWidth = 3,
  ...props
}: CircularProgressProps) {
  const radius = 50 - strokeWidth / 2

  return (
    <div
      role="status"
      aria-label="Chargement en cours"
      className={cn("inline-flex items-center justify-center", className)}
      {...props}
    >
      <svg
        className="animate-spin"
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="opacity-20"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray="220 90"
          transform="rotate(-90 50 50)"
        />
      </svg>
    </div>
  )
}

export { CircularProgress }
