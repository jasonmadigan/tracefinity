// dashboard "how it works" illustrations and trace sidebar hint illustrations

export function PhotoIllustration() {
  return (
    <svg viewBox="0 0 200 140" fill="none" className="w-full h-full">
      {/* table surface */}
      <rect x="10" y="20" width="180" height="110" rx="4" fill="#111827" />

      {/* paper sheet */}
      <rect x="40" y="32" width="120" height="85" rx="1" fill="#e2e8f0" />

      {/* tool silhouettes on paper */}
      {/* screwdriver */}
      <path d="M60 50 L60 95 Q60 100 65 100 Q70 100 70 95 L70 50 Q70 45 65 42 Q60 45 60 50Z" fill="#475569" />
      <rect x="62" y="42" width="6" height="8" rx="1" fill="#334155" />

      {/* wrench */}
      <path d="M95 45 C90 45 88 50 88 55 L88 58 L92 58 L92 90 L98 90 L98 58 L102 58 L102 55 C102 50 100 45 95 45Z" fill="#475569" />
      <circle cx="95" cy="50" r="3" fill="#334155" />

      {/* pliers */}
      <path d="M120 48 L118 70 L115 72 L118 95 L122 95 L125 72 L122 70 L120 48Z" fill="#475569" />
      <path d="M130 48 L132 70 L135 72 L132 95 L128 95 L125 72 L128 70 L130 48Z" fill="#475569" />

      {/* camera icon above */}
      <rect x="85" y="2" width="30" height="20" rx="3" fill="#2475c6" />
      <circle cx="100" cy="13" r="5" fill="#0a0f1a" />
      <circle cx="100" cy="13" r="3" fill="#2475c6" />
      <rect x="93" y="3" width="8" height="3" rx="1" fill="#1d6bb5" />

      {/* downward arrow from camera */}
      <path d="M100 24 L96 28 L104 28Z" fill="#2475c6" />
    </svg>
  )
}

export function CornersIllustration() {
  return (
    <svg viewBox="0 0 200 140" fill="none" className="w-full h-full">
      {/* dark background */}
      <rect x="10" y="10" width="180" height="120" rx="4" fill="#0f172a" />

      {/* perspective-skewed paper */}
      <path d="M50 30 L160 25 L170 110 L35 115Z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />

      {/* corner handles */}
      {[
        [50, 30], [160, 25], [170, 110], [35, 115],
      ].map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r="7" fill="#2475c6" />
          <circle cx={cx} cy={cy} r="3" fill="white" />
        </g>
      ))}

      {/* dotted alignment lines */}
      <line x1="50" y1="30" x2="160" y2="25" stroke="#2475c6" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
      <line x1="160" y1="25" x2="170" y2="110" stroke="#2475c6" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
      <line x1="170" y1="110" x2="35" y2="115" stroke="#2475c6" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
      <line x1="35" y1="115" x2="50" y2="30" stroke="#2475c6" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />

      {/* drag arrows on one corner */}
      <path d="M173 106 L183 100" stroke="#64748b" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
      <path d="M173 114 L183 120" stroke="#64748b" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6Z" fill="#64748b" />
        </marker>
      </defs>
    </svg>
  )
}

export function TraceIllustration() {
  return (
    <svg viewBox="0 0 200 140" fill="none" className="w-full h-full">
      {/* left panel: photo */}
      <rect x="8" y="15" width="80" height="110" rx="3" fill="#1e293b" />
      {/* tool shape in photo (coloured) */}
      <path d="M30 35 L30 100 Q30 105 38 105 Q46 105 46 100 L46 35 Q46 28 38 25 Q30 28 30 35Z" fill="#475569" />
      <path d="M55 40 L53 75 L50 78 L53 105 L57 105 L60 78 L57 75 L55 40Z" fill="#475569" />

      {/* arrow in the middle */}
      <path d="M95 70 L105 70" stroke="#2475c6" strokeWidth="2" />
      <path d="M103 65 L110 70 L103 75" fill="#2475c6" />

      {/* right panel: mask */}
      <rect x="112" y="15" width="80" height="110" rx="3" fill="#f1f5f9" />
      {/* tool shape in mask (black) */}
      <path d="M134 35 L134 100 Q134 105 142 105 Q150 105 150 100 L150 35 Q150 28 142 25 Q134 28 134 35Z" fill="#0a0f1a" />
      <path d="M159 40 L157 75 L154 78 L157 105 L161 105 L164 78 L161 75 L159 40Z" fill="#0a0f1a" />

      {/* "AI" label on arrow */}
      <text x="102" y="62" textAnchor="middle" fill="#2475c6" fontSize="9" fontWeight="600">AI</text>
    </svg>
  )
}

export function OrganiseIllustration() {
  return (
    <svg viewBox="0 0 200 140" fill="none" className="w-full h-full">
      {/* bin base (gridfinity grid) */}
      <rect x="20" y="25" width="126" height="100" rx="3" fill="#1e293b" stroke="#334155" strokeWidth="1" />

      {/* grid lines */}
      {[42, 84].map((x) => (
        <line key={`v${x}`} x1={20 + x} y1="25" x2={20 + x} y2="125" stroke="#334155" strokeWidth="0.5" />
      ))}
      {[33, 66].map((y) => (
        <line key={`h${y}`} x1="20" y1={25 + y} x2="146" y2={25 + y} stroke="#334155" strokeWidth="0.5" />
      ))}

      {/* tool shapes placed in grid */}
      <path d="M35 35 L35 80 Q35 85 42 85 Q49 85 49 80 L49 35 Q49 30 42 28 Q35 30 35 35Z" fill="#475569" stroke="#94a3b8" strokeWidth="0.5" />
      <path d="M75 40 L73 78 L70 80 L73 115 L77 115 L80 80 L77 78 L75 40Z" fill="#475569" stroke="#94a3b8" strokeWidth="0.5" />
      <path d="M105 35 C100 35 98 40 98 45 L98 48 L102 48 L102 85 L108 85 L108 48 L112 48 L112 45 C112 40 110 35 105 35Z" fill="#475569" stroke="#94a3b8" strokeWidth="0.5" />

      {/* download arrow */}
      <g transform="translate(165, 55)">
        <rect x="-10" y="-10" width="30" height="30" rx="15" fill="#2475c6" opacity="0.15" />
        <path d="M5 -4 L5 6" stroke="#2475c6" strokeWidth="2" strokeLinecap="round" />
        <path d="M0 3 L5 8 L10 3" stroke="#2475c6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="0" y1="11" x2="10" y2="11" stroke="#2475c6" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* ".STL" label */}
      <text x="170" y="95" textAnchor="middle" fill="#64748b" fontSize="9" fontWeight="500">.STL</text>
    </svg>
  )
}

// compact sidebar variants for the trace page

export function CornersHint() {
  return (
    <svg viewBox="0 0 220 60" fill="none" className="w-full">
      {/* mini photo */}
      <rect x="5" y="5" width="210" height="50" rx="3" fill="#0f172a" />

      {/* skewed paper */}
      <path d="M30 12 L120 10 L125 48 L25 50Z" fill="#e2e8f0" opacity="0.8" />

      {/* corner dots */}
      {[
        [30, 12], [120, 10], [125, 48], [25, 50],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="4" fill="#2475c6" />
      ))}

      {/* arrow from cursor to corner */}
      <path d="M145 20 L128 12" stroke="#64748b" strokeWidth="1" strokeDasharray="3 2" />
      {/* cursor icon */}
      <path d="M145 16 L145 28 L149 24 L154 30 L156 28 L151 22 L155 22Z" fill="#94a3b8" />
    </svg>
  )
}

export function TraceHint() {
  return (
    <svg viewBox="0 0 220 60" fill="none" className="w-full">
      <rect x="5" y="5" width="210" height="50" rx="3" fill="#0f172a" />

      {/* photo side */}
      <rect x="15" y="12" width="70" height="36" rx="2" fill="#1e293b" />
      <path d="M35 18 L35 40 Q35 44 42 44 Q49 44 49 40 L49 18 Q49 14 42 12 Q35 14 35 18Z" fill="#475569" />

      {/* arrow */}
      <path d="M92 30 L118 30" stroke="#2475c6" strokeWidth="1.5" />
      <path d="M115 26 L121 30 L115 34" fill="#2475c6" />
      <text x="105" y="25" textAnchor="middle" fill="#2475c6" fontSize="7" fontWeight="600">AI</text>

      {/* mask side */}
      <rect x="125" y="12" width="70" height="36" rx="2" fill="#e2e8f0" />
      <path d="M145 18 L145 40 Q145 44 152 44 Q159 44 159 40 L159 18 Q159 14 152 12 Q145 14 145 18Z" fill="#0a0f1a" />
    </svg>
  )
}

export function EditHint() {
  return (
    <svg viewBox="0 0 220 60" fill="none" className="w-full">
      <rect x="5" y="5" width="210" height="50" rx="3" fill="#0f172a" />

      {/* polygon outline */}
      <polygon
        points="40,15 90,12 95,48 35,50"
        fill="none"
        stroke="#2475c6"
        strokeWidth="1.5"
      />

      {/* vertices */}
      {[
        [40, 15], [90, 12], [95, 48], [35, 50],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3" fill="#2475c6" />
      ))}

      {/* dragging one vertex */}
      <circle cx="95" cy="48" r="5" fill="#2475c6" opacity="0.3" />
      <path d="M100 48 L115 42" stroke="#64748b" strokeWidth="1" strokeDasharray="3 2" />
      {/* cursor */}
      <path d="M115 38 L115 50 L119 46 L124 52 L126 50 L121 44 L125 44Z" fill="#94a3b8" />

      {/* label */}
      <text x="160" y="32" fill="#64748b" fontSize="8">drag to adjust</text>
    </svg>
  )
}
