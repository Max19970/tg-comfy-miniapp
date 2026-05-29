import { authorizedImageUrl } from '../api/client.js';

export function ImageGrid({ images = [], initData, variant = 'default' }) {
  if (!images.length) return null;

  return (
    <section className={`imageGrid ${variant}`}>
      {images.map((image, index) => {
        const url = authorizedImageUrl(image.url, initData);
        return (
          <a key={`${image.url}-${index}`} href={url} target="_blank" rel="noreferrer" className="imageCard">
            <img src={url} alt={image.filename || `generation-${index + 1}`} loading="lazy" />
            {image.filename && <span>{image.filename}</span>}
          </a>
        );
      })}
    </section>
  );
}
