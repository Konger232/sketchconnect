import smiley from '../../assets/images/ico-profile.png'

/**
 * A person's round picture: their avatar, or the smiley face when there is
 * none. The one rule for avatars everywhere.
 *
 *   url        the avatar image, if any
 *   className  size and border (e.g. 'h-9 w-9')
 */
export default function Avatar({ url, className = 'h-9 w-9', alt = '' }) {
  return (
    <span className={`ed-avatar inline-flex shrink-0 items-center justify-center ${className}`}>
      {url
        ? <img src={url} alt={alt} className="h-full w-full object-cover" />
        : <img src={smiley} alt={alt} className="h-[70%] w-[70%] object-contain" />}
    </span>
  )
}
