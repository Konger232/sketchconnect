import Button from './Button'
import cameraWhite from '../../assets/images/ico_camera_w.png'
import cameraBlack from '../../assets/images/ico_camera.png'

/**
 * The empty photo stage of the dark modals (New Sketch, Upload sketch):
 * a dashed dropzone that fills the left side, with the camera icon, a
 * title and one line. Tapping it opens the camera. It fills its stage,
 * inset by --stage-inset from 768px. The stage around it sets the height
 * (New Sketch: 55vh on a phone).
 *
 * light: black on white, for the white pages (the Sketcher page's empty
 * bag photo); it keeps its own size instead of filling a stage.
 */
export default function PhotoDropzone({ title, text, onClick, light = false, className = '' }) {
  return (
    <div className={light ? `flex ${className}` : 'flex flex-1 p-5 md:p-[var(--stage-inset)]'}>
      <Button className={`reset-button-styles block flex h-full w-full flex-1 p-0 ${light ? '!bg-white' : ''}`} onClick={onClick}>
        <div className={light ? 'sc-dropzone border-ink/30 bg-white text-ink hover:border-ink' : 'sc-dropzone'}>
          <img src={light ? cameraBlack : cameraWhite} alt="camera" className={light ? 'h-12 w-12' : 'h-16 w-16 text-white'} />
          <p className={`font-heading font-semibold leading-snug ${light ? 'text-lg' : 'text-xl'}`}>{title}</p>
          <p className={`max-w-[270px] ${light ? 'text-sm text-ink/60' : 'text-base text-sc-text3'}`}>{text}</p>
        </div>
      </Button>
    </div>
  )
}
