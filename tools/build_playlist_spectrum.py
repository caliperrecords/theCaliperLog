from __future__ import annotations

import argparse
import colorsys
import io
import json
import re
import statistics
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


PLAYLIST_URL = "https://music.163.com/playlist?id={playlist_id}"
PLAYLIST_DETAIL_URL = "https://music.163.com/api/v6/playlist/detail?id={playlist_id}"
SONG_URL = "https://music.163.com/song?id={song_id}"
SONG_DETAIL_URL = "https://music.163.com/api/song/detail/?id={song_id}&ids=%5B{song_id}%5D"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    ),
    "Referer": "https://music.163.com/",
}


@dataclass
class Track:
    song_id: str
    title: str
    artist: str = ""
    cover: str = ""


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8", "ignore")


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def playlist_id_from_url(value: str) -> str:
    match = re.search(r"[?&]id=(\d+)", value)
    if match:
        return match.group(1)
    if value.isdigit():
        return value
    raise ValueError(f"Could not find playlist id in {value!r}")


def clean_text(value: str) -> str:
    value = re.sub(r"<.*?>", "", value)
    return urllib.parse.unquote(value).strip()


def parse_playlist(html: str) -> list[Track]:
    seen: set[str] = set()
    tracks: list[Track] = []
    for song_id, title in re.findall(r'<a href="/song\?id=(\d+)">(.*?)</a>', html):
        if song_id in seen:
            continue
        seen.add(song_id)
        tracks.append(Track(song_id=song_id, title=clean_text(title)))
    return tracks


def parse_playlist_detail(playlist_id: str) -> list[Track]:
    detail = json.loads(fetch_text(PLAYLIST_DETAIL_URL.format(playlist_id=playlist_id)))
    playlist = detail.get("playlist") or {}
    tracks = playlist.get("tracks") or []
    privileges = playlist.get("trackIds") or []
    if tracks and len(tracks) >= len(privileges):
        return [
            Track(
                song_id=str(item.get("id")),
                title=item.get("name", ""),
                artist=" / ".join(artist.get("name", "") for artist in item.get("ar", item.get("artists", [])) if artist.get("name")),
                cover=((item.get("al") or item.get("album") or {}).get("picUrl", "") + "?param=640y640")
                if (item.get("al") or item.get("album") or {}).get("picUrl")
                else "",
            )
            for item in tracks
            if item.get("id")
        ]
    by_id = {str(item.get("id")): item for item in tracks if item.get("id")}
    expanded: list[Track] = []
    for item in privileges:
        song_id = str(item.get("id"))
        if not song_id or song_id == "None":
            continue
        track = by_id.get(song_id, {})
        album = track.get("al") or track.get("album") or {}
        cover = album.get("picUrl", "")
        expanded.append(
            Track(
                song_id=song_id,
                title=track.get("name", ""),
                artist=" / ".join(artist.get("name", "") for artist in track.get("ar", track.get("artists", [])) if artist.get("name")),
                cover=(cover.split("?")[0] + "?param=640y640") if cover else "",
            )
        )
    return expanded


def parse_song_detail(song_id: str) -> tuple[str, str, str]:
    detail = json.loads(fetch_text(SONG_DETAIL_URL.format(song_id=song_id)))
    song = detail["songs"][0]
    title = song.get("name", "")
    artists = song.get("artists", [])
    artist = " / ".join(item.get("name", "") for item in artists if item.get("name"))
    album = song.get("album") or {}
    cover = album.get("picUrl", "")
    if cover:
        cover = cover.split("?")[0] + "?param=640y640"
    return title, artist, cover


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def sample_pixels(image: Image.Image) -> list[tuple[int, int, int]]:
    image = image.convert("RGB")
    image.thumbnail((90, 90))
    pixels = list(image.getdata())
    return [pixel for pixel in pixels if not (pixel[0] < 8 and pixel[1] < 8 and pixel[2] < 8)]


def dominant_colors(pixels: list[tuple[int, int, int]], max_colors: int = 3) -> list[tuple[int, int, int]]:
    buckets: dict[tuple[int, int, int], list[tuple[int, int, int]]] = {}
    for r, g, b in pixels:
        key = (round(r / 28), round(g / 28), round(b / 28))
        buckets.setdefault(key, []).append((r, g, b))

    ranked = sorted(buckets.values(), key=len, reverse=True)[: max_colors * 3]
    colors: list[tuple[int, int, int]] = []
    for bucket in ranked:
        color = tuple(round(statistics.mean(channel)) for channel in zip(*bucket))
        if all(sum(abs(color[i] - existing[i]) for i in range(3)) > 54 for existing in colors):
            colors.append(color)  # type: ignore[arg-type]
        if len(colors) == max_colors:
            break
    return colors


def analyze_cover(cover_url: str) -> dict[str, object]:
    data = fetch_bytes(cover_url)
    image = Image.open(io.BytesIO(data))
    pixels = sample_pixels(image)
    if not pixels:
        pixels = [(244, 245, 241)]

    colors = dominant_colors(pixels, 3)
    h_values: list[float] = []
    s_values: list[float] = []
    v_values: list[float] = []
    warm_score = 0.0

    for r, g, b in pixels[:: max(1, len(pixels) // 1200)]:
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        h_values.append(h * 360)
        s_values.append(s)
        v_values.append(v)
        if s > 0.12:
            if h * 360 < 70 or h * 360 > 320:
                warm_score += s
            elif 160 <= h * 360 <= 270:
                warm_score -= s

    saturation = statistics.mean(s_values)
    brightness = statistics.mean(v_values)
    whiteness = sum(1 for r, g, b in pixels if r > 210 and g > 210 and b > 210) / len(pixels)
    darkness = sum(1 for r, g, b in pixels if r < 55 and g < 55 and b < 55) / len(pixels)
    hue = circular_mean(h_values)

    if whiteness > 0.46 and saturation < 0.25:
        family = "white"
        temperature = 0.5
    elif darkness > 0.48 and brightness < 0.35:
        family = "black"
        temperature = 0.08
    elif saturation < 0.16:
        family = "neutral"
        temperature = 0.48
    else:
        family, temperature = classify_hue(hue)

    return {
        "palette": [rgb_to_hex(color) for color in colors],
        "hue": round(hue, 2),
        "saturation": round(saturation, 3),
        "brightness": round(brightness, 3),
        "whiteness": round(whiteness, 3),
        "darkness": round(darkness, 3),
        "family": family,
        "temperature": round(temperature, 3),
    }


def circular_mean(values: list[float]) -> float:
    if not values:
        return 0.0
    x = sum(__import__("math").cos(__import__("math").radians(v)) for v in values)
    y = sum(__import__("math").sin(__import__("math").radians(v)) for v in values)
    angle = __import__("math").degrees(__import__("math").atan2(y, x))
    return angle % 360


def classify_hue(hue: float) -> tuple[str, float]:
    if 200 <= hue <= 260:
        return "blue", 0.12
    if 160 <= hue < 200:
        return "cyan", 0.22
    if 95 <= hue < 160:
        return "green", 0.34
    if 55 <= hue < 95:
        return "yellow", 0.72
    if 25 <= hue < 55:
        return "orange", 0.84
    if hue < 25 or hue >= 340:
        return "red", 0.95
    if 260 < hue < 340:
        return "violet", 0.04
    return "neutral", 0.5


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("playlist", help="NetEase playlist URL or id")
    parser.add_argument("--out", default="data/playlist-spectrum.json")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    playlist_id = playlist_id_from_url(args.playlist)
    tracks = parse_playlist_detail(playlist_id)
    if not tracks:
        playlist_html = fetch_text(PLAYLIST_URL.format(playlist_id=playlist_id))
        tracks = parse_playlist(playlist_html)
    if args.limit:
        tracks = tracks[: args.limit]

    results: list[dict[str, object]] = []
    for index, track in enumerate(tracks, start=1):
        try:
            cover = track.cover
            if not track.cover or not track.artist:
                detail_title, artist, cover = parse_song_detail(track.song_id)
                if detail_title:
                    track.title = detail_title
                track.artist = artist
                track.cover = cover
            if cover:
                color = analyze_cover(cover)
            else:
                color = {
                    "palette": ["#f4f5f1"],
                    "hue": 0,
                    "saturation": 0,
                    "brightness": 0.95,
                    "whiteness": 1,
                    "darkness": 0,
                    "family": "white",
                    "temperature": 0.5,
                }
            results.append(
                {
                    "number": index,
                    "id": track.song_id,
                    "title": track.title,
                    "artist": track.artist,
                    "cover": track.cover,
                    "url": f"https://music.163.com/#/song?id={track.song_id}",
                    "color": color,
                }
            )
            print(f"{index:03d}/{len(tracks):03d} {track.title} -> {color['family']}")
            time.sleep(0.12)
        except Exception as exc:  # noqa: BLE001
            print(f"skip {track.song_id} {track.title}: {exc}")

    ordered = sorted(results, key=lambda item: (item["color"]["temperature"], item["color"]["brightness"]))  # type: ignore[index]
    payload = {
        "source": f"https://music.163.com/#/playlist?id={playlist_id}",
        "playlistId": playlist_id,
        "count": len(ordered),
        "generatedAt": time.strftime("%Y-%m-%d"),
        "tracks": ordered,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out} ({len(ordered)} tracks)")


if __name__ == "__main__":
    main()
