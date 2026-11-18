// 민초: a scoop of mint-chocolate-chip ice cream. Original character drawn for QuizMe.
export type Mood = 'happy' | 'cheer' | 'sad' | 'think' | 'sleep' | 'wow';

type Props = { mood?: Mood; size?: number; className?: string; title?: string };

function Face({ mood }: { mood: Mood }) {
  const eye = 'var(--choco-900)';
  switch (mood) {
    case 'sleep':
      return (
        <g stroke={eye} strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M38 58q5 4 10 0M72 58q5 4 10 0" />
          <path d="M55 72q5 3 10 0" />
        </g>
      );
    case 'sad':
      return (
        <g>
          <ellipse cx="43" cy="58" rx="4.5" ry="5.5" fill={eye} />
          <ellipse cx="77" cy="58" rx="4.5" ry="5.5" fill={eye} />
          <path d="M52 76q8-7 16 0" stroke={eye} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M84 64q2 5 0 8q-3-3 0-8z" fill="#7cc8ff" />
        </g>
      );
    case 'think':
      return (
        <g>
          <ellipse cx="43" cy="57" rx="4.5" ry="5.5" fill={eye} />
          <ellipse cx="77" cy="57" rx="4.5" ry="5.5" fill={eye} />
          <path d="M54 75h12" stroke={eye} strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case 'wow':
      return (
        <g>
          <ellipse cx="43" cy="56" rx="5" ry="6.5" fill={eye} />
          <ellipse cx="77" cy="56" rx="5" ry="6.5" fill={eye} />
          <circle cx="45" cy="54" r="1.8" fill="#fff" />
          <circle cx="79" cy="54" r="1.8" fill="#fff" />
          <ellipse cx="60" cy="75" rx="5" ry="6" fill={eye} />
        </g>
      );
    case 'cheer':
      return (
        <g stroke={eye} strokeWidth="3.2" strokeLinecap="round" fill="none">
          <path d="M37 59q6-8 12 0M71 59q6-8 12 0" />
          <path d="M50 70q10 12 20 0z" fill={eye} />
        </g>
      );
    default:
      return (
        <g>
          <ellipse cx="43" cy="57" rx="4.5" ry="5.5" fill={eye} />
          <ellipse cx="77" cy="57" rx="4.5" ry="5.5" fill={eye} />
          <circle cx="45" cy="55" r="1.6" fill="#fff" />
          <circle cx="79" cy="55" r="1.6" fill="#fff" />
          <path d="M52 70q8 8 16 0" stroke={eye} strokeWidth="3.2" strokeLinecap="round" fill="none" />
        </g>
      );
  }
}

export function Mascot({ mood = 'happy', size = 96, className, title }: Props) {
  return (
    <svg
      className={`mascot mascot-${mood} ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {/* cone */}
      <path d="M38 86 60 116 82 86z" fill="#e9b872" />
      <path d="M44 90l26 14M50 98l22-10M41 88l14 18M76 90 62 108" stroke="#c98d47" strokeWidth="2" strokeLinecap="round" />
      {/* scoop */}
      <path
        d="M60 14c22 0 38 15 38 36 0 9-3 17-8 23 5 1 8 5 8 9 0 6-5 8-10 6-4 3-9 4-14 2-4 4-10 4-14 0-5 2-10 1-14-2-5 2-10 0-10-6 0-4 3-8 8-9-5-6-8-14-8-23 0-21 16-36 38-36z"
        fill="var(--mascot-mint, #8fe3cf)"
      />
      <path d="M32 40q6-14 22-18" stroke="#fff" strokeOpacity=".7" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* chips */}
      <g fill="var(--choco-700)">
        <rect x="64" y="26" width="7" height="5" rx="1.5" transform="rotate(20 67 28)" />
        <rect x="30" y="66" width="6" height="5" rx="1.5" transform="rotate(-25 33 68)" />
        <rect x="86" y="40" width="6" height="5" rx="1.5" transform="rotate(35 89 42)" />
        <rect x="48" y="30" width="5" height="4" rx="1.2" transform="rotate(-10 50 32)" />
        <rect x="84" y="70" width="6" height="4" rx="1.2" transform="rotate(15 87 72)" />
      </g>
      {/* cheeks */}
      <ellipse cx="34" cy="66" rx="5" ry="3" fill="#ff9aa2" opacity=".55" />
      <ellipse cx="86" cy="66" rx="5" ry="3" fill="#ff9aa2" opacity=".55" />
      <Face mood={mood} />
    </svg>
  );
}
