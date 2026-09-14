// Central sizing knobs for the wizard/AI-flow's two-panel (black photo +
// white controls) screens: SceneAnalyzerWizard.jsx's phase A and style step,
// FocalFrameEditor.jsx, and GuidedPromptFlow.jsx. All four read from here
// so retuning panel height or the photo's max width is a one-file edit.
//
// `WIZARD_PANEL_HEIGHT_PX` / `WIZARD_PANEL_HEIGHT_CLASS` must be kept in
// sync manually if you change one: the class is the literal Tailwind
// token (Tailwind can't see a dynamically-built arbitrary value, so this
// exact string has to appear somewhere in source for the utility to be
// generated), while the numeric constant feeds FocalFrameEditor's
// `panelHeightPx` prop, which needs a real number for its sizing math.
//
// `WIZARD_IMAGE_MAX_WIDTH_CLASS` caps how wide a landscape/panorama photo
// is allowed to render inside the black panel on desktop. Without it, a
// wide photo just fills the whole 70%-width track edge to edge, which
// can look overwhelming -- lower the pixel value for a more contained
// photo, or delete the class where it's applied to let photos run as
// wide as the panel again. Mobile is untouched either way; this only
// applies at the md: breakpoint.
//
// Separately: every two-panel grid in this app should use
// `minmax(0,7fr)_minmax(0,3fr)` rather than a bare `7fr_3fr` -- a plain
// (non-absolutely-positioned) <img> sized by aspect ratio can otherwise
// force the grid track to grow past its intended 70% share to fit the
// image's intrinsic width, squeezing the white panel down to make room.
// `minmax(0, ...)` pins the track to the fr ratio regardless of content.
export const WIZARD_PANEL_HEIGHT_PX = 520
export const WIZARD_PANEL_HEIGHT_CLASS = 'md:h-[520px]'
export const WIZARD_IMAGE_MAX_WIDTH_CLASS = 'md:max-w-[560px]'

// A thin outline drawn on the reference photo itself (not the black
// canvas around it) inside FocalFrameEditor.jsx's frame-adjusting phase
// -- without it, nothing distinguishes the photo's actual edge from the
// surrounding black background once it's been panned or zoomed, so it's
// hard to tell how much of the photo is currently in frame vs. cropped
// out. Tune color/thickness here (Tailwind border-width/color utilities,
// e.g. 'border-2 border-white/50' for a thicker line, or dial the
// opacity back down if solid white ever reads as too strong).
export const WIZARD_IMAGE_BORDER_CLASS = 'border border-black'
