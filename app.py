import json
import os
import subprocess
import threading
import uuid
from io import BytesIO
from pathlib import Path

from dotenv import load_dotenv
import fal_client
import numpy as np
import requests as http_requests
from flask import Flask, jsonify, render_template, request, send_file, send_from_directory
from PIL import Image, ImageFilter

load_dotenv()

app = Flask(__name__)

IMAGES_DIR = Path(os.environ.get("IMAGES_DIR", "../island-images/island-images"))
RESULTS_FILE = Path("./results.json")
CATEGORIES = ["fruits", "vegetables", "everyday"]

STYLE = (
    "Children's coloring book illustration, clean black outlines, smooth flat "
    "colors with subtle shading, moderate detail, appealing rounded shapes, "
    "slightly realistic proportions, no face, no expression, no anthropomorphization."
)

# item readable descriptions – extend as needed
ITEM_DESCRIPTIONS = {
    "apple": "a red apple with a short stem and a green leaf",
    "banana": "a yellow banana with slight brown spots",
    "cherry": "a pair of red cherries with green stems",
    "grape": "a bunch of purple grapes",
    "kiwi": "a brown kiwi fruit cut in half showing green flesh",
    "lemon": "a bright yellow lemon",
    "mango": "a ripe orange-yellow mango",
    "orange": "a round orange with a small leaf",
    "peach": "a fuzzy peach with a green leaf",
    "pear": "a green pear with a brown stem",
    "pineapple": "a pineapple with spiky green leaves on top",
    "strawberry": "a red strawberry with green leaves and small seeds",
    "watermelon": "a watermelon slice showing red flesh and black seeds",
    "broccoli": "a head of green broccoli",
    "cabbage": "a round green cabbage",
    "carrot": "an orange carrot with green leafy top",
    "corn": "an ear of yellow corn with green husks",
    "cucumber": "a green cucumber",
    "eggplant": "a dark purple eggplant",
    "garlic": "a white garlic bulb",
    "lettuce": "a head of green lettuce",
    "mushroom": "a brown mushroom with a white stem",
    "onion": "a brown onion",
    "pepper": "a red bell pepper",
    "potato": "a brown potato",
    "pumpkin": "an orange pumpkin with a green stem",
    "tomato": "a red tomato with a green stem",
    "backpack": "a colorful backpack",
    "ball": "a colorful bouncy ball",
    "book": "an open book with colorful pages",
    "bottle": "a water bottle",
    "brush": "a paintbrush with colorful bristles",
    "bucket": "a small bucket",
    "candle": "a lit candle",
    "clock": "a round wall clock",
    "crayon": "a colorful crayon",
    "cup": "a ceramic cup",
    "envelope": "a white envelope",
    "eraser": "a pink eraser",
    "flashlight": "a flashlight",
    "fork": "a silver fork",
    "glasses": "a pair of glasses",
    "glue": "a bottle of glue",
    "hammer": "a hammer with wooden handle",
    "hat": "a hat",
    "key": "a golden key",
    "knife": "a kitchen knife",
    "lamp": "a desk lamp",
    "magnet": "a horseshoe magnet",
    "magnifying_glass": "a magnifying glass",
    "marker": "a colored marker",
    "mirror": "a round mirror",
    "mug": "a coffee mug",
    "notebook": "a spiral notebook",
    "paintbrush": "a paintbrush",
    "pen": "a ballpoint pen",
    "pencil": "a yellow pencil with eraser",
    "plate": "a white dinner plate",
    "ruler": "a wooden ruler",
    "scissors": "a pair of scissors",
    "shoe": "a sneaker shoe",
    "soap": "a bar of soap",
    "socks": "a pair of colorful socks",
    "spoon": "a silver spoon",
    "stapler": "a stapler",
    "tape": "a roll of tape",
    "toothbrush": "a toothbrush",
    "umbrella": "a colorful umbrella",
    "watch": "a wristwatch",
}

BG_DESCRIPTIONS = {
    "fruits": "a sunny orchard with fruit trees, green grass and blue sky",
    "vegetables": "a sunny vegetable garden with rows of plants and rich soil",
    "everyday": "a clean, bright indoor scene with a wooden table and soft natural light",
}

# In-memory job tracking
REGEN_JOBS_FILE = Path("./regen_jobs.json")
REGEN_LOGS_DIR = Path("./regen_logs")
AGENT_SESSIONS_DIR = Path(os.path.expanduser("~/.openclaw/agents/island-prompt/sessions"))

_regen_jobs_lock = threading.Lock()

def _load_regen_jobs():
    if REGEN_JOBS_FILE.exists():
        try:
            with open(REGEN_JOBS_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def _save_regen_jobs():
    with open(REGEN_JOBS_FILE, "w") as f:
        json.dump(regen_jobs, f)

regen_jobs = _load_regen_jobs()


def load_results():
    if RESULTS_FILE.exists():
        with open(RESULTS_FILE) as f:
            return json.load(f)
    return {}


def save_results(results):
    with open(RESULTS_FILE, "w") as f:
        json.dump(results, f, indent=2)


def scan_items():
    items = {}
    for category in CATEGORIES:
        cat_dir = IMAGES_DIR / category
        if not cat_dir.exists():
            continue
        names = set()
        for f in cat_dir.iterdir():
            if f.suffix == ".png":
                stem = f.stem
                for suffix in ["-object-orig", "-object", "-scene", "-background"]:
                    if stem.endswith(suffix):
                        names.add(stem[: -len(suffix)])
                        break
        items[category] = sorted(names)
    return items


ITEMS = scan_items()
results = load_results()


def get_item_desc(item):
    return item.replace("_", " ")


def get_bg_desc(category):
    return BG_DESCRIPTIONS.get(category, BG_DESCRIPTIONS["everyday"])


def download_image(url, path):
    r = http_requests.get(url, timeout=120)
    r.raise_for_status()
    with open(path, "wb") as f:
        f.write(r.content)
    return path


def call_openclaw_agent(message, log_key=None):
    """Call island-prompt agent with a fresh UUID session. Deletes session after use."""
    import datetime
    session_id = str(uuid.uuid4())
    session_file = AGENT_SESSIONS_DIR / f"{session_id}.jsonl"
    try:
        result = subprocess.run(
            ["openclaw", "agent", "--agent", "island-prompt",
             "--session-id", session_id, "--json", "--message", message],
            capture_output=True, text=True, timeout=120,
        )
        response_text = None
        if result.returncode == 0:
            raw_data = json.loads(result.stdout)
            payloads = raw_data.get("result", {}).get("payloads", [])
            response_text = payloads[0].get("text", "") if payloads else ""
            if not response_text:
                response_text = raw_data.get("content", raw_data.get("message", ""))
            if isinstance(response_text, list):
                response_text = " ".join(str(t.get("text", t)) if isinstance(t, dict) else str(t) for t in response_text)
            response_text = response_text.strip().strip('"').strip("'")

        # 디버그 로그 저장
        if log_key:
            log_dir = REGEN_LOGS_DIR / Path(log_key).parent
            log_dir.mkdir(parents=True, exist_ok=True)
            log_path = REGEN_LOGS_DIR / f"{log_key}.json"
            with open(log_path, "w") as f:
                json.dump({
                    "timestamp": datetime.datetime.now().isoformat(),
                    "request": message,
                    "response": response_text,
                    "exit_code": result.returncode,
                    "stderr": result.stderr[:500] if result.stderr else None,
                }, f, indent=2, ensure_ascii=False)

        return response_text if response_text else None
    except Exception as e:
        app.logger.error(f"openclaw agent error: {e}")
    finally:
        # 세션 파일 즉시 삭제 (세션 누적 방지)
        if session_file.exists():
            session_file.unlink()
    return None


def generate_bg_prompt(category, item, comment=""):
    """Use openclaw agent to generate a background scene description."""
    prompt_lines = [
        "You are a prompt engineer for a children's coloring book image generator.",
        f'Generate ONE background scene description (1-2 sentences, English) for "{item}" that would be placed in a {category} coloring book illustration.',
        "The object is large and close-up, filling most of the frame. The scene should be cheerful, simple, and child-friendly.",
    ]
    if comment and comment.strip():
        prompt_lines.append(f'User feedback (Korean, apply this): "{comment}"')
    prompt_lines.append("Reply with ONLY the background scene description, nothing else.")
    message = "\n".join(prompt_lines)

    text = call_openclaw_agent(message, log_key=f"{category}/{item}")
    if text:
        return text
    return get_bg_desc(category)


def generate_bg_prompts_batch(items_list):
    """Use openclaw agent to generate background prompts for multiple items at once."""
    item_strs = ", ".join(f"{e['item']} ({e['category']})" for e in items_list)
    message = (
        "Generate background scene descriptions for these items for a children's coloring book.\n"
        f"Items: {item_strs}\n"
        'For each item, provide: item_key: "background scene description (1-2 sentences, English, cheerful, child-friendly)"\n'
        'Reply as JSON object only, example: {"apple": "...", "carrot": "..."}'
    )
    text = call_openclaw_agent(message, log_key="batch/latest")
    if text:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except Exception:
                pass
    return {}


def run_pipeline(category, item, job_id, item_key, bg_desc_override=None, comment=""):
    """Run the full regeneration pipeline for a single item."""
    job = regen_jobs[job_id]
    item_status = job["items"][item_key]
    item_status["status"] = "running"
    item_status["completed_steps"] = []
    _save_regen_jobs()

    tmp_dir = Path(f"/tmp/regen_{job_id}_{item}")
    tmp_dir.mkdir(parents=True, exist_ok=True)
    out_dir = IMAGES_DIR / category

    item_desc = get_item_desc(item)
    bg_desc = bg_desc_override if bg_desc_override else get_bg_desc(category)

    try:
        # Step 1: Generate object (white background)
        item_status["step"] = "generating object"
        comment_hint = f" Additional notes: {comment}." if comment and comment.strip() else ""
        r = fal_client.run("fal-ai/nano-banana-2", arguments={
            "prompt": (
                f"{item_desc}, centered, with at least 25% white margin on every side (top, bottom, left, right), "
                f"object occupies no more than 50% of image width and height, single object only, plain white background."
                f"{comment_hint} {STYLE}"
            ),
            "aspect_ratio": "4:3",
            "output_format": "png",
        })
        obj_raw_url = r["images"][0]["url"]
        download_image(obj_raw_url, tmp_dir / "obj_raw.png")
        download_image(obj_raw_url, out_dir / f"{item}-object-orig.png")
        item_status["completed_steps"].append("object_raw"); _save_regen_jobs()

        # Step 2: BiRefNet background removal
        item_status["step"] = "removing background"
        r = fal_client.run("fal-ai/birefnet/v2", arguments={
            "image_url": obj_raw_url,
            "output_format": "png",
        })
        obj_url = r["image"]["url"]
        download_image(obj_url, tmp_dir / "object.png")
        download_image(obj_url, out_dir / f"{item}-object.png")
        item_status["completed_steps"].append("object"); _save_regen_jobs()

        # Step 3: Scene generation (fill background)
        item_status["step"] = "generating scene"
        r = fal_client.run("fal-ai/nano-banana-2/edit", arguments={
            "image_urls": [obj_raw_url],
            "prompt": (
                f"Keep the {item_desc} exactly as is, do not modify it at all. "
                f"Close-up shot, zoomed in. "
                f"Fill the white background with {bg_desc}. {STYLE}"
            ),
            "output_format": "png",
        })
        scene_url = r["images"][0]["url"]
        download_image(scene_url, tmp_dir / "scene.png")
        download_image(scene_url, out_dir / f"{item}-scene.png")
        item_status["completed_steps"].append("scene"); _save_regen_jobs()

        # Step 4: Red overlay mask (PIL)
        item_status["step"] = "creating mask"
        scene_img = Image.open(tmp_dir / "scene.png").convert("RGBA")
        obj_img = Image.open(tmp_dir / "object.png").convert("RGBA")

        if obj_img.size != scene_img.size:
            obj_img = obj_img.resize(scene_img.size, Image.LANCZOS)

        alpha = np.array(obj_img)[:, :, 3]
        obj_mask = alpha > 30

        mask_img = Image.fromarray((obj_mask * 255).astype(np.uint8))
        mask_img = mask_img.filter(ImageFilter.MaxFilter(7))
        obj_mask = np.array(mask_img) > 128

        scene_arr = np.array(scene_img).copy()
        red_overlay = scene_arr.copy()
        red_overlay[obj_mask] = [255, 0, 0, 255]

        blended = scene_arr.copy()
        blended[obj_mask] = (
            0.4 * scene_arr[obj_mask] + 0.6 * red_overlay[obj_mask]
        ).astype(np.uint8)

        masked_scene = Image.fromarray(blended).convert("RGB")
        masked_path = tmp_dir / "scene_masked.png"
        masked_scene.save(masked_path)

        masked_url = fal_client.upload_file(str(masked_path))

        # Step 5: Background generation (remove object)
        item_status["step"] = "generating background"
        readable = item.replace("_", " ")
        r = fal_client.run("fal-ai/nano-banana-2/edit", arguments={
            "image_urls": [masked_url],
            "prompt": (
                f"Remove the red-highlighted {readable} and fill the area naturally "
                f"with {bg_desc}. Make it look like the {readable} was never there. {STYLE}"
            ),
            "output_format": "png",
        })
        bg_url = r["images"][0]["url"]
        download_image(bg_url, out_dir / f"{item}-background.png")
        item_status["completed_steps"].append("background"); _save_regen_jobs()

        item_status["status"] = "done"
        item_status["step"] = "complete"

    except Exception as e:
        item_status["status"] = "failed"
        item_status["error"] = str(e)

    # Update job counters
    statuses = [v["status"] for v in job["items"].values()]
    job["done"] = statuses.count("done")
    job["failed"] = statuses.count("failed")
    _save_regen_jobs()


# ── Routes ──


@app.route("/")
def index():
    return render_template("index.html", items=ITEMS, categories=CATEGORIES)


@app.route("/images/<category>/<filename>")
def serve_image(category, filename):
    return send_from_directory(IMAGES_DIR / category, filename)


@app.route("/review", methods=["POST"])
def review():
    data = request.json
    item = data["item"]
    category = data["category"]
    status = data["status"]
    key = f"{category}/{item}"
    results[key] = status
    save_results(results)
    return jsonify({"ok": True})


@app.route("/results")
def get_results():
    return jsonify(results)


@app.route("/failed_items")
def failed_items():
    failed = []
    for key, status in results.items():
        if status == "fail":
            category, item = key.split("/", 1)
            failed.append({"category": category, "item": item})
    return jsonify(failed)


@app.route("/regenerate_single", methods=["POST"])
def regenerate_single():
    data = request.json
    category = data.get("category", "")
    item = data.get("item", "")
    obj_comment = data.get("obj_comment", "")
    bg_comment = data.get("bg_comment", "")

    if not category or not item:
        return jsonify({"error": "category and item required"}), 400

    job_id = str(uuid.uuid4())[:8]
    key = f"{category}/{item}"
    job = {
        "total": 1,
        "done": 0,
        "failed": 0,
        "items": {key: {"status": "pending", "step": "generating prompt"}},
    }
    regen_jobs[job_id] = job

    def worker():
        bg_desc = generate_bg_prompt(category, item, bg_comment)
        run_pipeline(category, item, job_id, key, bg_desc_override=bg_desc, comment=obj_comment)

    t = threading.Thread(target=worker, daemon=True)
    t.start()

    return jsonify({"job_id": job_id})


@app.route("/regenerate", methods=["POST"])
def regenerate():
    data = request.json
    items_to_regen = data.get("items", [])
    if not items_to_regen:
        return jsonify({"error": "No items provided"}), 400

    job_id = str(uuid.uuid4())[:8]
    job = {
        "total": len(items_to_regen),
        "done": 0,
        "failed": 0,
        "items": {},
    }

    for entry in items_to_regen:
        key = f"{entry['category']}/{entry['item']}"
        job["items"][key] = {"status": "pending", "step": "generating prompts"}

    regen_jobs[job_id] = job

    def batch_worker():
        # Generate all background prompts at once via LLM
        bg_prompts = generate_bg_prompts_batch(items_to_regen)

        for entry in items_to_regen:
            key = f"{entry['category']}/{entry['item']}"
            bg_desc = bg_prompts.get(entry["item"], get_bg_desc(entry["category"]))
            t = threading.Thread(
                target=run_pipeline,
                args=(entry["category"], entry["item"], job_id, key),
                kwargs={"bg_desc_override": bg_desc},
                daemon=True,
            )
            t.start()

    t = threading.Thread(target=batch_worker, daemon=True)
    t.start()

    return jsonify({"job_id": job_id})


@app.route("/regen_status/<job_id>")
def regen_status(job_id):
    job = regen_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@app.route("/regen_active")
def regen_active():
    """Return all jobs that have at least one pending/running item."""
    active = {}
    for jid, job in regen_jobs.items():
        statuses = [v["status"] for v in job["items"].values()]
        if "pending" in statuses or "running" in statuses:
            active[jid] = job
    return jsonify(active)


@app.route("/regen_log/<category>/<item>")
def regen_log(category, item):
    log_path = REGEN_LOGS_DIR / category / f"{item}.json"
    if not log_path.exists():
        return jsonify({"error": "Not found"}), 404
    with open(log_path) as f:
        return jsonify(json.load(f))


@app.route("/composite/<category>/<item>")
def composite_image(category, item):
    bg_path = IMAGES_DIR / category / f"{item}-background.png"
    obj_path = IMAGES_DIR / category / f"{item}-object.png"
    if not bg_path.exists() or not obj_path.exists():
        return "Not found", 404

    bg = Image.open(bg_path).convert("RGBA")
    obj = Image.open(obj_path).convert("RGBA")

    # Center the object on the background
    ox = (bg.width - obj.width) // 2
    oy = (bg.height - obj.height) // 2
    bg.paste(obj, (ox, oy), obj)

    buf = BytesIO()
    bg.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7788))
    app.run(host="0.0.0.0", port=port, debug=True)
