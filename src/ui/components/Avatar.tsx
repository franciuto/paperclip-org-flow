import type { Pose, PersonView } from "../../shared/types.js";
import { initials, poseUrl } from "../format.js";

/** Neutral "person" glyph used for human users (board). */
export function UserGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="8.5" r="4.2" />
      <path d="M4 20.5c.9-4.3 4-6.6 8-6.6s7.1 2.3 8 6.6z" />
    </svg>
  );
}

type AvatarPerson = Pick<PersonView, "kind" | "name" | "paletteId" | "customAvatarUrl">;

/** Small HTML avatar: character pose, uploaded photo, or user glyph. Decorative (alt=""). */
export function Avatar({ person, pose = "idle", size = 20, title }: { person: AvatarPerson | null | undefined; pose?: Pose; size?: number; title?: string }) {
  const style = { width: size, height: size };
  if (!person) {
    return <span className="of-av of-av-user" style={style} title={title} aria-hidden="true">?</span>;
  }
  if (person.kind === "user") {
    return (
      <span className="of-av of-av-user" style={style} title={title ?? person.name} aria-hidden="true">
        <UserGlyph />
      </span>
    );
  }
  if (person.customAvatarUrl) {
    return <img className="of-av of-av-photo" src={person.customAvatarUrl} alt="" width={size} height={size} style={style} title={title ?? person.name} loading="lazy" />;
  }
  if (person.paletteId) {
    return <img className="of-av" src={poseUrl(person.paletteId, pose)} alt="" width={size} height={size} style={style} title={title ?? person.name} loading="lazy" />;
  }
  return (
    <span className="of-av of-av-user" style={{ ...style, fontSize: Math.max(8, size * 0.38), fontWeight: 700 }} title={title ?? person.name} aria-hidden="true">
      {initials(person.name)}
    </span>
  );
}

/** Org Flow icon (three people linked), used in the sidebar link and the widget. */
export function OrgIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="5" cy="6" r="2.5" /><circle cx="19" cy="6" r="2.5" /><circle cx="12" cy="19" r="2.5" />
      <path d="M7.5 6h9M6.5 8.2l4.2 8.6M17.5 8.2l-4.2 8.6" />
    </svg>
  );
}
