// How sketchers are named (October 27, 2026):
//   lists and cards (Explore, search, sketch and event cards, comments,
//   "people you follow")   @username: unique, the same as the profile link,
//                          and it keeps real names out of lists
//   pages with room        the name with the @username beside it
//                          (components/common/NameHandle.jsx)
export const handle = (p, fallback = 'A sketcher') =>
  (p?.username ? `@${p.username}` : p?.display_name || fallback)
