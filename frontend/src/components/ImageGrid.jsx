import { authorizedImageUrl } from '../api/client.js';

export function ImageGrid({ images = [], initData }) {
  if (!images.length) return null;
  return (
    <section className="imageGrid">
      {images.map((image, index) => {
        const url = authorizedImageUrl(image.url, initData);
        return (
          <a key={`${image.url}-${index}`} href={url} target="_blank" rel="noreferrer" className="imageCard">
            <img src={url} alt={image.filename || `generation-${index + 1}`} loading="lazy" />
          </a>
        );
      })}
    </section>
  );
}
