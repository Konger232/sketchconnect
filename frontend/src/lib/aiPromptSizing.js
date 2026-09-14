// Central sizing knobs for the AI guided-prompt UI: the question card
// (AIPromptModal.jsx), the palette picker (ColorPalettePicker.jsx), and
// the inline Help Quest form (GuidedPromptFlow.jsx). All three read their
// text/padding/icon sizes from here instead of hardcoding their own
// Tailwind classes, so retuning any of it is a one-file edit -- no
// hunting through JSX.
//
// Convention: each entry has a base value (applied at every width -- the
// app's existing mobile scale, left untouched -- "keep it consistent
// with the rest of the style" on mobile) and an `*Md` sibling that only
// takes effect at the md: breakpoint (tablet/desktop). The two-panel
// wizard/AI-flow layout gives this content a lot more horizontal and
// vertical room on desktop than it needs, which is what was reading as
// "super big" -- every `*Md` value below is roughly 15-25% smaller than
// its mobile counterpart to correct for that.
//
// To fine-tune: edit any single line below (standard Tailwind classes,
// or an arbitrary value like `text-[11px]` where no standard step lands
// close enough). Delete an `*Md` line entirely to make that element match
// mobile at every width.
export const AI_PROMPT_SIZES = {
  // AIPromptModal.jsx -- the question text, and every option/"Ask me" button
  questionText: 'text-base font-semibold',
  questionTextMd: 'md:text-sm',
  optionText: 'text-sm',
  optionTextMd: 'md:text-xs',
  optionPadding: 'px-4 py-2.5',
  optionPaddingMd: 'md:px-3 md:py-2',
  optionGap: 'gap-2',
  optionGapMd: 'md:gap-1.5',

  // ColorPalettePicker.jsx
  paletteHeadingText: 'text-base font-semibold',
  paletteHeadingTextMd: 'md:text-sm',
  paletteSwatchSize: 'h-16 w-16',
  paletteSwatchSizeMd: 'md:h-12 md:w-12',
  paletteLabelText: 'text-xs font-medium',
  paletteLabelTextMd: 'md:text-[11px]',
  paletteGrid: 'gap-3',
  paletteGridMd: 'md:gap-2',

  // Help Quest inline form (GuidedPromptFlow.jsx)
  helpHeadingText: 'text-base font-semibold',
  helpHeadingTextMd: 'md:text-sm',
  helpInputText: 'text-sm',
  helpInputTextMd: 'md:text-xs',
  helpInputPadding: 'px-3 py-2',
  helpInputPaddingMd: 'md:px-2.5 md:py-1.5',

  // Shared bits used by more than one of the surfaces above
  mascotIcon: 'h-5 w-5',
  mascotIconMd: 'md:h-4 md:w-4',
  closeIcon: 'text-xl leading-none',
  closeIconMd: 'md:text-lg',
  // Note: the shared <Button> component now has its own size="sm" prop
  // (components/common/Button.jsx) for exactly this flow -- pass
  // size="sm" at any Button used inside GuidedPromptFlow.jsx rather than
  // overriding its className here.
}
