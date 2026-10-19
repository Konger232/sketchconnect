import Button from './Button'
import cameraWhite from '../../assets/images/ico_camera_w.png'

/**
 * The empty photo stage of the dark modals (New Sketch, Upload sketch):
 * a dashed dropzone that fills the left side, with the camera icon, a
 * title and one line. Tapping it opens the camera. It fills its stage,
 * inset by --stage-inset from 768px. The stage around it sets the height
 * (New Sketch: 55vh on a phone).
 */
export default function PhotoDropzone({ title, text, onClick }) {
  return (
    <div className="flex flex-1 p-5 md:p-[var(--stage-inset)]">
      <Button className="reset-button-styles block flex h-full w-full flex-1 p-0" onClick={onClick}>
        <div className="sc-dropzone">
          <img src={cameraWhite} alt="camera" className="h-16 w-16 text-white" />
          <p className="font-heading text-xl font-semibold leading-snug">{title}</p>
          <p className="max-w-[270px] text-base text-sc-text3">{text}</p>
        </div>
      </Button>
    </div>
  )
}
