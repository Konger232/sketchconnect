/**
 * One place for the app's icons.
 *
 *   <Icon name="edit" className="h-7 w-7" />      an SVG from ICONS below
 *   <Icon src={someImage} alt="…" />                an image file instead
 *
 * SVG icons draw in the text colour (currentColor), so colour them with a
 * text class, e.g. className="h-5 w-5 text-white". Size comes from `size`
 * (px) or from width/height classes in className, which win over `size`.
 *
 * Adding an icon: give it its own viewBox (copy it from the source SVG,
 * don't change it, or the drawing is cropped) and say whether it's drawn
 * with a fill or a stroke. Paste only the <path> elements, and change
 * fixed colours like fill="#000000" to nothing, so currentColor applies.
 */

const FILL = { fill: 'currentColor', stroke: 'none' }
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const ICONS = {
  // Delete trash can
  delete: {
    viewBox:'0 0 24 24',
    draw: STROKE,
    content: (
      <>
        <path d="M4 7H20"></path> 
        <path d="M6 10L7.70141 19.3578C7.87432 20.3088 8.70258 21 9.66915 21H14.3308C15.2974 21 16.1257 20.3087 16.2986 19.3578L18 10"></path>
        <path d="M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5V7H9V5Z"></path>
      </>
    ),
  },
  
  // Pencil on a page (Phosphor "note-pencil", filled).
  edit: {
    viewBox: '0 0 24 24',
    draw: FILL,
    content: (
      <path d="M20.0651 7.39423L7.09967 20.4114C6.72438 20.7882 6.21446 21 5.68265 21H4.00383C3.44943 21 3 20.5466 3 19.9922V18.2987C3 17.7696 3.20962 17.2621 3.58297 16.8873L16.5517 3.86681C19.5632 1.34721 22.5747 4.87462 20.0651 7.39423Z" />
    ),
  },

  // Picture with an up arrow, for "Upload final sketch" (SVG Repo).
  'upload-image': {
    viewBox: '0 0 24 24',
    draw: STROKE,
    content: (
      <>
        <path d="M13 4H8.8C7.11984 4 6.27976 4 5.63803 4.32698C5.07354 4.6146 4.6146 5.07354 4.32698 5.63803C4 6.27976 4 7.11984 4 8.8V15.2C4 16.8802 4 17.7202 4.32698 18.362C4.6146 18.9265 5.07354 19.3854 5.63803 19.673C6.27976 20 7.11984 20 8.8 20H15.2C16.8802 20 17.7202 20 18.362 19.673C18.9265 19.3854 19.3854 18.9265 19.673 18.362C20 17.7202 20 16.8802 20 15.2V11" />
        <path d="M4 16L8.29289 11.7071C8.68342 11.3166 9.31658 11.3166 9.70711 11.7071L13 15M13 15L15.7929 12.2071C16.1834 11.8166 16.8166 11.8166 17.2071 12.2071L20 15M13 15L15.25 17.25" />
        <path d="M18 8V3M18 3L16 5M18 3L20 5" />
      </>
    ),
  },

  // Map pin (SVG Repo "location", filled).
  location: {
    viewBox: '-4 0 32 32',
    draw: FILL,
    content: (
      <path
        transform="translate(-106 -413)"
        d="M118,422 C116.343,422 115,423.343 115,425 C115,426.657 116.343,428 118,428 C119.657,428 121,426.657 121,425 C121,423.343 119.657,422 118,422 L118,422 Z M118,430 C115.239,430 113,427.762 113,425 C113,422.238 115.239,420 118,420 C120.761,420 123,422.238 123,425 C123,427.762 120.761,430 118,430 L118,430 Z M118,413 C111.373,413 106,418.373 106,425 C106,430.018 116.005,445.011 118,445 C119.964,445.011 130,429.95 130,425 C130,418.373 124.627,413 118,413 L118,413 Z"
      />
    ),
  },

  // Outline map pin, for fields (SVG Repo).
  'location-outline': {
    viewBox: '0 0 24 24',
    draw: STROKE,
    content: (
      <>
        <path d="M12 21C15.5 17.4 19 14.1764 19 10.2C19 6.22355 15.866 3 12 3C8.13401 3 5 6.22355 5 10.2C5 14.1764 8.5 17.4 12 21Z" />
        <path d="M12 13C13.6569 13 15 11.6569 15 10C15 8.34315 13.6569 7 12 7C10.3431 7 9 8.34315 9 10C9 11.6569 10.3431 13 12 13Z" />
      </>
    ),
  },

  // Close / clear (SVG Repo, filled X).
  close: {
    viewBox: '0 0 1024 1024',
    draw: FILL,
    content: (
      <path d="M195.2 195.2a64 64 0 0 1 90.496 0L512 421.504 738.304 195.2a64 64 0 0 1 90.496 90.496L602.496 512 828.8 738.304a64 64 0 0 1-90.496 90.496L512 602.496 285.696 828.8a64 64 0 0 1-90.496-90.496L421.504 512 195.2 285.696a64 64 0 0 1 0-90.496z" />
    ),
  },

  // Chevron pointing up.
  'chevron-up': {
    viewBox: '0 0 20 20',
    draw: { ...STROKE, strokeWidth: 1.8 },
    content: <path d="M5 12.5 10 7.5l5 5" />,
  },

  // Camera, for "Take photo" (line icon, design handoff).
  camera: {
    viewBox: '0 0 24 24',
    draw: STROKE,
    content: (
      <>
        <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
        <circle cx="12" cy="13.5" r="3.5" />
      </>
    ),
  },

  // Guide rail (GuideStage.jsx): the collapsed Guides button and the
  // four groups. From the design handoff.
  layers: {
    viewBox: '0 0 24 24',
    draw: STROKE,
    content: (
      <>
        <path d="M12 3 3 8l9 5 9-5-9-5Z" />
        <path d="m3 13 9 5 9-5" />
      </>
    ),
  },
  'guide-plan': {
    viewBox: '0 0 24 24',
    draw: STROKE,
    content: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  'guide-space': {
    viewBox: '0 0 24 24',
    draw: STROKE,
    content: (
      <>
        <path d="M2 12h20" strokeDasharray="3 3" />
        <path d="M4 20 12 12 20 20" />
        <path d="M4 4l8 8 8-8" />
      </>
    ),
  },
  'guide-shape': {
    viewBox: '0 0 24 24',
    draw: STROKE,
    content: (
      <>
        <rect x="3" y="9" width="12" height="12" rx="1" />
        <circle cx="16" cy="8" r="5" />
      </>
    ),
  },
  'guide-value': {
    viewBox: '0 0 24 24',
    draw: STROKE,
    content: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
      </>
    ),
  },

  // Check mark (selected style card, done steps).
  check: {
    viewBox: '0 0 24 24',
    draw: { ...STROKE, strokeWidth: 3 },
    content: <path d="m5 12 5 5 9-10" />,
  },

  // Habits (Feedback tab): a loop, something repeated.
  habit: {
    viewBox: '0 0 24 24',
    draw: { ...STROKE, strokeWidth: 2 },
    content: (
      <>
        <path d="M4 12a8 8 0 0 1 14-5.3" />
        <path d="M20 12a8 8 0 0 1-14 5.3" />
        <path d="M18 3v4h-4" />
        <path d="M6 21v-4h4" />
      </>
    ),
  },

  // Opportunities (Feedback tab): an arrow up and forward.
  opportunity: {
    viewBox: '0 0 24 24',
    draw: { ...STROKE, strokeWidth: 2 },
    content: (
      <>
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </>
    ),
  },

  // Pen, for the Marks step.
  pen: {
    viewBox: '0 0 24 24',
    draw: STROKE,
    content: <path d="M4 20l4-1 11-11-3-3L5 16l-1 4Z" />,
  },

  // Chevron pointing right, for the next button inside a picked choice.
  'chevron-right': {
    viewBox: '0 0 20 20',
    draw: { ...STROKE, strokeWidth: 1.8 },
    content: <path d="M7.5 5 12.5 10l-5 5" />,
  },

  // Chevron pointing down (chevron-up, flipped).
  'chevron-down': {
    viewBox: '0 0 20 20',
    draw: { ...STROKE, strokeWidth: 1.8 },
    content: <path d="M5 7.5 10 12.5l5-5" />,
  },
}

export function Icon({ name, src, alt = '', size = 24, className = '', ...props }) {
  // An image file: render it as an <img>.
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        className={`select-none object-contain ${className}`}
        {...props}
      />
    )
  }

  const icon = ICONS[name]
  if (!icon) {
    if (import.meta.env.DEV) console.warn(`Icon: no icon named "${name}"`)
    return null
  }

  return (
    <svg
      viewBox={icon.viewBox}
      width={size}
      height={size}
      aria-hidden={alt ? undefined : true}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      className={`shrink-0 ${className}`}
      {...icon.draw}
      {...props}
    >
      {icon.content}
    </svg>
  )
}

export default Icon
