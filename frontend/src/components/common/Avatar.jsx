import smiley from '../../assets/images/ico-profile.png'
import { imageUrl } from '../../lib/media'

/**
 * A person's round picture: their avatar, or the smiley face when there is
 * none. The one rule for avatars everywhere.
 *
 *   url        the avatar image, if any: a full web address (Google,
 *              Supabase Storage) or a backend path such as /uploads/x.png
 *   className  size and border (e.g. 'h-9 w-9')
 */
export default function Avatar({ url, className = 'h-9 w-9', alt = '' }) {
  return (
    <span className={`ed-avatar inline-flex shrink-0 items-center justify-center ${className}`}>
      {url
        ? <img src={imageUrl(url)} alt={alt} className="h-full w-full object-cover" />
        : <img src={smiley} alt={alt} className="h-[70%] w-[70%] object-contain" />}
    </span>
  )
}
