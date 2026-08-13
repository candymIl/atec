from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1920, 1080
NAVY = "#102a4f"
BLUE = "#1f4f8b"
ELECTRIC = "#2766e8"
GREEN = "#16a45b"
INK = "#13213a"
MUTED = "#65758b"
PALE = "#edf4ff"
WHITE = "#ffffff"
BG = "#f6f9fe"

ROOT = Path(__file__).resolve().parent
FRAMES = ROOT / "expo_frames"
FRAMES.mkdir(parents=True, exist_ok=True)
LABEL = Path(r"C:\Users\JACQUE~1\AppData\Local\Temp\codex-clipboard-422e14dd-94f7-4946-9cda-4924f8a5d985.png")
APPROVED_LOGO = Path(__file__).resolve().parents[1] / "frontend" / "public" / "logo.jpg"
FONT_REG = Path(r"C:\Windows\Fonts\segoeui.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")

def font(size, bold=False):
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT_REG), size)

def canvas():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 18), fill=ELECTRIC)
    d.ellipse((1500, -310, 2160, 350), fill="#e7efff")
    d.ellipse((-260, 780, 300, 1340), fill="#e9f7ef")
    return im, d

def brand(im, d):
    logo = Image.open(APPROVED_LOGO).convert("RGB")
    logo.thumbnail((145, 145), Image.Resampling.LANCZOS)
    d.rounded_rectangle((78, 42, 245, 209), radius=22, fill=WHITE, outline="#dbe5f3", width=2)
    im.paste(logo, (89, 53))
    d.text((275, 72), "ATEC SYSTEMS", font=font(42, True), fill=NAVY)
    d.text((278, 126), "INSPECTION PLATFORM", font=font(18, True), fill=MUTED)

def footer(d, number):
    d.text((88, 1020), "www.atecinspections.co.za", font=font(24, True), fill=NAVY)
    d.text((1748, 1020), f"{number:02d}", font=font(22, True), fill=MUTED)

def title(d, eyebrow, heading, sub=None):
    d.text((90, 205), eyebrow.upper(), font=font(25, True), fill=ELECTRIC)
    d.text((86, 250), heading, font=font(72, True), fill=INK)
    if sub:
        d.text((90, 350), sub, font=font(30), fill=MUTED)

def card(d, box, heading, body, accent=ELECTRIC, icon=None):
    x1, y1, x2, y2 = box
    d.rounded_rectangle(box, radius=28, fill=WHITE, outline="#dbe5f3", width=2)
    d.rounded_rectangle((x1, y1, x1 + 12, y2), radius=6, fill=accent)
    if icon:
        d.ellipse((x1 + 34, y1 + 34, x1 + 104, y1 + 104), fill=accent)
        d.text((x1 + 55, y1 + 43), icon, font=font(34, True), fill=WHITE)
        tx = x1 + 128
    else:
        tx = x1 + 38
    d.text((tx, y1 + 35), heading, font=font(30, True), fill=INK)
    d.multiline_text((tx, y1 + 88), body, font=font(23), fill=MUTED, spacing=9)

def save(im, idx):
    im.save(FRAMES / f"scene-{idx:02d}.png", quality=95)

# 1 — hero
im, d = canvas(); brand(im, d)
d.text((88, 290), "TAP.", font=font(118, True), fill=NAVY)
d.text((88, 425), "INSPECT.", font=font(118, True), fill=ELECTRIC)
d.text((88, 560), "CERTIFY.", font=font(118, True), fill=GREEN)
d.text((98, 735), "Every asset. One digital identity.", font=font(38), fill=MUTED)
d.rounded_rectangle((1230, 250, 1730, 750), radius=70, fill=NAVY)
d.rounded_rectangle((1260, 285, 1700, 715), radius=48, fill=WHITE)
d.arc((1370, 355, 1590, 575), 210, 510, fill=ELECTRIC, width=16)
d.arc((1415, 400, 1545, 530), 210, 510, fill=ELECTRIC, width=14)
d.ellipse((1470, 455, 1495, 480), fill=ELECTRIC)
d.text((1345, 600), "NFC + QR", font=font(42, True), fill=NAVY)
footer(d, 1); save(im, 1)

# 2 — problem
im, d = canvas(); brand(im, d); title(d, "The challenge", "Compliance should not depend on paperwork")
card(d, (90, 465, 600, 835), "Records scattered", "Paper files, folders and emails\nslow down every lookup.", "#d94645", "!")
card(d, (705, 465, 1215, 835), "Certificates delayed", "Teams waste time finding the\nlatest inspection evidence.", "#ee9b24", "?")
card(d, (1320, 465, 1830, 835), "Visibility lost", "Due dates and failed assets can\nbe missed without one view.", "#6b62d9", "×")
footer(d, 2); save(im, 2)

# 3 — identity
im, d = canvas(); brand(im, d); title(d, "Digital asset identity", "One label connects the physical asset to its records")
if LABEL.exists():
    lab = Image.open(LABEL).convert("RGB")
    crop = lab.crop((0, 0, lab.width, min(lab.height, int(lab.height * .87))))
    crop.thumbnail((1010, 590), Image.Resampling.LANCZOS)
    shadow = Image.new("RGBA", (crop.width + 40, crop.height + 40), (0,0,0,0))
    ImageDraw.Draw(shadow).rounded_rectangle((20,20,crop.width+20,crop.height+20), radius=20, fill=(15,35,65,35))
    shadow = shadow.filter(ImageFilter.GaussianBlur(12))
    im.paste(shadow, (75, 422), shadow)
    im.paste(crop, (95, 430))
card(d, (1190, 460, 1815, 635), "NFC tap", "Open live asset status instantly.", GREEN, "N")
card(d, (1190, 675, 1815, 850), "QR scan", "View certificates or start work.", ELECTRIC, "Q")
footer(d, 3); save(im, 3)

# 4 — tap
im, d = canvas(); brand(im, d); title(d, "Tap to know", "Instant asset information", "Status and certificates—available at the equipment")
d.rounded_rectangle((110, 450, 690, 865), radius=38, fill=NAVY)
d.rounded_rectangle((145, 485, 655, 830), radius=26, fill=WHITE)
d.text((200, 525), "ASSET 32793", font=font(30, True), fill=MUTED)
d.text((200, 585), "OVERHEAD CRANE", font=font(39, True), fill=INK)
d.text((200, 660), "SAFE", font=font(54, True), fill=GREEN)
d.text((200, 740), "Certificates available", font=font(26), fill=MUTED)
for r in (90, 150, 210): d.arc((760-r, 555-r, 760+r, 555+r), 300, 60, fill=ELECTRIC, width=12)
d.ellipse((747, 542, 773, 568), fill=ELECTRIC)
card(d, (1020, 450, 1815, 600), "Instant status", "See whether the asset is safe and current.", GREEN, "S")
card(d, (1020, 635, 1815, 785), "Certificate access", "Download or print inspection records on demand.", ELECTRIC, "C")
footer(d, 4); save(im, 4)

# 5 — perform inspection
im, d = canvas(); brand(im, d); title(d, "Inspect at the asset", "Find it by NFC or QR", "Then follow a controlled inspection or load-test workflow")
d.rounded_rectangle((90, 440, 840, 865), radius=34, fill=WHITE, outline="#dbe5f3", width=2)
d.text((135, 485), "QUICK INSPECTION / TEST", font=font(27, True), fill=NAVY)
d.rounded_rectangle((135, 555, 790, 625), radius=14, fill=PALE)
d.text((165, 572), "Scan NFC Tag or QR Code", font=font(25), fill=MUTED)
d.rounded_rectangle((135, 665, 430, 735), radius=14, fill=GREEN)
d.text((190, 685), "SCAN NFC TAG", font=font(23, True), fill=WHITE)
d.rounded_rectangle((455, 665, 790, 735), radius=14, fill=ELECTRIC)
d.text((510, 685), "SCAN WITH CAMERA", font=font(23, True), fill=WHITE)
card(d, (960, 440, 1815, 590), "Wizard Inspect", "Guided visual inspection criteria.", GREEN, "1")
card(d, (960, 625, 1815, 775), "Wizard Load Test", "Structured testing and recorded results.", ELECTRIC, "2")
footer(d, 5); save(im, 5)

# 6 — workflow
im, d = canvas(); brand(im, d); title(d, "Guided and consistent", "Complete inspections. Complete evidence.")
steps = [("01", "Identify", "Confirm asset and location"), ("02", "Inspect", "Complete guided criteria"), ("03", "Evidence", "Add findings and photos"), ("04", "Approve", "Record status and sign-off")]
for i,(n,h,b) in enumerate(steps):
    x=90+i*450
    d.ellipse((x,470,x+95,565), fill=ELECTRIC if i<3 else GREEN)
    d.text((x+25,490), n, font=font(28,True), fill=WHITE)
    if i<3: d.line((x+110,518,x+420,518), fill="#b8c9df", width=8)
    d.text((x,615), h, font=font(34,True), fill=INK)
    d.multiline_text((x,670), b, font=font(24), fill=MUTED, spacing=8)
footer(d, 6); save(im, 6)

# 7 — cert
im, d = canvas(); brand(im, d); title(d, "From inspection to certificate", "Inspection evidence stays connected")
d.rounded_rectangle((95, 430, 870, 875), radius=32, fill=WHITE, outline="#cbd8e8", width=3)
d.rectangle((95,430,870,520), fill=NAVY)
d.text((140,455), "CERTIFICATE OF INSPECTION", font=font(28,True), fill=WHITE)
d.text((140,565), "Asset", font=font(21,True), fill=MUTED); d.text((340,560), "Overhead Crane", font=font(28,True), fill=INK)
d.text((140,635), "Status", font=font(21,True), fill=MUTED); d.text((340,625), "SAFE", font=font(34,True), fill=GREEN)
d.text((140,710), "Next inspection", font=font(21,True), fill=MUTED); d.text((340,705), "12 AUG 2027", font=font(28,True), fill=INK)
d.line((140,800,820,800), fill="#cbd8e8", width=2)
d.text((140,820), "Secure digital record", font=font(20), fill=MUTED)
card(d, (1040, 455, 1815, 605), "Evidence attached", "Asset and inspection photographs.", ELECTRIC, "+")
card(d, (1040, 640, 1815, 790), "Ready to share", "Download and print available certificates.", GREEN, "R")
footer(d, 7); save(im, 7)

# 8 — management
im, d = canvas(); brand(im, d); title(d, "Know what needs attention", "Live visibility across every asset")
metrics=[("15 784","ASSETS",ELECTRIC),("3 575","VALID CERTIFICATES",GREEN),("1","OVERDUE","#d94645"),("8","EXPIRING SOON","#ee9b24")]
for i,(v,l,c) in enumerate(metrics):
    x=90+i*440
    d.rounded_rectangle((x,455,x+390,680), radius=30, fill=WHITE, outline="#dbe5f3", width=2)
    d.rectangle((x,455,x+390,467), fill=c)
    d.text((x+34,505),v,font=font(54,True),fill=INK)
    d.text((x+36,590),l,font=font(21,True),fill=MUTED)
d.rounded_rectangle((90,735,1830,880), radius=28, fill=NAVY)
d.text((145,775), "Due dates  •  Failed assets  •  Inspection history  •  Customer visibility", font=font(34,True), fill=WHITE)
footer(d, 8); save(im, 8)

# 9 — close
im, d = canvas(); brand(im, d)
d.text((300, 300), "TAP.  INSPECT.  CERTIFY.", font=font(78, True), fill=NAVY)
d.text((465, 435), "Digital compliance at every asset.", font=font(38), fill=MUTED)
d.rounded_rectangle((580, 570, 1340, 680), radius=28, fill=ELECTRIC)
d.text((696, 598), "BOOK A LIVE DEMONSTRATION", font=font(30, True), fill=WHITE)
d.text((630, 755), "www.atecinspections.co.za", font=font(42, True), fill=NAVY)
d.text((770, 835), "011 902 3271", font=font(32), fill=MUTED)
footer(d, 9); save(im, 9)

print(FRAMES)
