from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import subprocess, textwrap, shutil

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'platform-overview'
FRAMES=OUT/'frames'; AUDIO=OUT/'audio'; CLIPS=OUT/'clips'
for p in (FRAMES,AUDIO,CLIPS): p.mkdir(parents=True,exist_ok=True)
W,H=1920,1080
NAVY='#102a4f'; BLUE='#2766e8'; GREEN='#16a45b'; INK='#13213a'; MUTED='#65758b'; BG='#f6f9fe'; WHITE='#ffffff'; LINE='#dbe5f3'; RED='#d94645'; AMBER='#ee9b24'
FONT=Path(r'C:\Windows\Fonts\segoeui.ttf'); BOLD=Path(r'C:\Windows\Fonts\segoeuib.ttf')
FFMPEG=ROOT.parent/'tools'/'ffmpeg-8.1.2'/'ffmpeg-8.1.2-essentials_build'/'bin'/'ffmpeg.exe'
LOGO=ROOT.parent/'frontend'/'public'/'logo.jpg'

SCENES=[
('ATEC SYSTEMS','One connected inspection and workforce platform','From planning the work to proving completion.',
 'ATEC Systems brings customers, assets, field inspections, workforce activity, certificates and management reporting into one connected platform.'),
('ONE OPERATIONAL VIEW','See the work that needs attention','Dashboard summaries turn operational records into action.',
 'The dashboard gives management a clear operational view, including registered assets, current and expiring certificates, overdue work, failed equipment and notifications that need attention.'),
('CUSTOMERS, SITES AND ASSETS','Build a reliable digital asset register','Structure every customer, site, section and responsible person.',
 'ATEC organises each customer, site, section, responsible person and asset in a consistent hierarchy. Equipment details, locations and inspection history stay connected to the correct record.'),
('PLAN THE WORK','Schedule visits and create job cards','Allocate technicians, crew, assets, priorities and planned dates.',
 'Office teams can plan on-site visits and create technician job cards. Each card connects the customer, site, equipment, assigned technician, supporting crew, priority and planned work.'),
('FIELD EXECUTION','One job card records the complete visit','Travel, work, materials, findings, deviations and customer acknowledgement.',
 'In the field, the job card records travel and work milestones, work performed, materials used, findings, deviations, equipment status, supporting evidence and customer acknowledgement.'),
('GUIDED INSPECTIONS','Consistent inspections for each equipment type','Controlled criteria, photographs, findings and test results.',
 'Inspectors use guided workflows for supported equipment types. The system captures controlled criteria, findings, photographs and results for inspections and load tests, reducing missed steps and inconsistent records.'),
('SAFETY CONTROLS','Critical failures cannot disappear in paperwork','Safety outcomes and deviations remain visible and traceable.',
 'Safety controls connect critical inspection failures to a not safe outcome. Deviations, immediate actions, follow-up work and equipment status remain visible and traceable.'),
('NFC AND QR ACCESS','Open the correct asset at the equipment','Tap or scan to view status, records and available certificates.',
 'NFC and QR labels provide fast access at the physical asset. A tap or scan can open the correct asset, show its status and history, provide available certificates, or begin authorised work.'),
('CERTIFICATES AND HISTORY','Evidence stays connected from inspection to certificate','Search, review, download and share controlled records.',
 'Completed inspection evidence remains connected to the asset and its certificate history. Authorised users can search, review, download and share the available inspection and load-test records.'),
('WORKFORCE AND TIME','Turn job activity into accountable time records','Employee confirmation, manager review, correction and approval.',
 'Job activity flows into employee time records. Employees review and submit their time, managers can return or correct it with an audit reason, and approved records move toward HR and payroll readiness.'),
('REPORTING AND HANDOVER','Bring the approved job evidence together','Job card, crew timesheets and linked certificates in one package.',
 'When workflow checks pass, the platform can assemble the approved job card, crew timesheets and linked certificates into a controlled completion package for the next business process.'),
('CUSTOMER VISIBILITY','Give customers access to their own information','Portal views, certificates, MPI and NDT records, and reports.',
 'Customer portal users receive role-controlled access to their own information, including available certificates, MPI and NDT records, and customer reporting without exposing other customers data.'),
('RISK AND COMPLIANCE','Support more than equipment inspection','SLAMM risk assessments, reporting and auditable decisions.',
 'ATEC also supports SLAMM risk assessments and reporting, bringing safety observations and decisions into the same controlled digital environment.'),
('CONTROL AND GOVERNANCE','The right access for the right responsibility','Role-based permissions, history, notifications and system health.',
 'Role-based permissions separate customer access, field execution, approval and administration. History, notifications and system health tools help teams manage the platform responsibly.'),
('THE COMPLETE WORKFLOW','Plan. Execute. Inspect. Approve. Report.','One connected record from customer request to verified evidence.',
 'The result is one connected workflow: organise the asset base, plan the work, execute in the field, inspect and test, approve the records, issue evidence and give management and customers clear visibility.'),
('ATEC SYSTEMS','Digital control for real inspection operations','Book a live demonstration  |  www.atecinspections.co.za  |  011 902 3271',
 'ATEC Systems. Digital control for real inspection operations. Book a live demonstration at atec inspections dot co dot z a.'),
]

def f(sz,b=False): return ImageFont.truetype(str(BOLD if b else FONT),sz)
def wrap(draw,text,width,font):
    words=text.split(); lines=[]; line=''
    for word in words:
        test=(line+' '+word).strip()
        if draw.textbbox((0,0),test,font=font)[2] <= width: line=test
        else: lines.append(line); line=word
    if line: lines.append(line)
    return '\n'.join(lines)
def base(i):
    im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
    d.rectangle((0,0,W,18),fill=BLUE); d.ellipse((1510,-330,2170,330),fill='#e7efff'); d.ellipse((-270,810,270,1350),fill='#e9f7ef')
    if LOGO.exists():
        logo=Image.open(LOGO).convert('RGB'); logo.thumbnail((105,105)); d.rounded_rectangle((72,44,195,167),20,fill=WHITE,outline=LINE,width=2); im.paste(logo,(81,53))
    d.text((225,62),'ATEC SYSTEMS',font=f(36,True),fill=NAVY); d.text((228,112),'INSPECTION PLATFORM',font=f(17,True),fill=MUTED)
    d.text((88,1023),'www.atecinspections.co.za',font=f(22,True),fill=NAVY); d.text((1770,1023),f'{i:02d}',font=f(21,True),fill=MUTED)
    return im,d
def pill(d,xy,label,color=BLUE):
    x,y=xy; box=d.textbbox((0,0),label,font=f(19,True)); w=box[2]+50
    d.rounded_rectangle((x,y,x+w,y+48),24,fill=color); d.text((x+25,y+11),label,font=f(19,True),fill=WHITE); return w
def card(d,box,title,body,color=BLUE):
    x1,y1,x2,y2=box; d.rounded_rectangle(box,26,fill=WHITE,outline=LINE,width=2); d.rectangle((x1,y1,x1+10,y2),fill=color)
    d.text((x1+38,y1+30),title,font=f(28,True),fill=INK); d.multiline_text((x1+38,y1+83),wrap(d,body,x2-x1-76,f(22)),font=f(22),fill=MUTED,spacing=8)
def make_frame(i,eyebrow,heading,sub):
    im,d=base(i); d.text((88,205),eyebrow,font=f(23,True),fill=BLUE); d.multiline_text((85,250),wrap(d,heading,1680,f(64,True)),font=f(64,True),fill=INK,spacing=8); d.multiline_text((90,405),wrap(d,sub,1640,f(29)),font=f(29),fill=MUTED,spacing=8)
    labels={
      1:['CUSTOMERS','ASSETS','WORKFORCE','INSPECTIONS','CERTIFICATES','REPORTING'],2:['ASSET STATUS','DUE WORK','FAILURES','NOTIFICATIONS'],3:['CUSTOMER','SITE','SECTION','ASSET'],4:['VISIT','JOB CARD','CREW','EQUIPMENT'],5:['TRAVEL','WORK','MATERIALS','EVIDENCE'],6:['CRANES','SLINGS','HARNESSES','CHAIN BLOCKS'],7:['CRITICAL CHECK','NOT SAFE','DEVIATION','FOLLOW-UP'],8:['NFC TAP','QR SCAN','ASSET STATUS','CERTIFICATES'],9:['INSPECTION','LOAD TEST','CERTIFICATE','HISTORY'],10:['MY DAY','SUBMIT','MANAGER REVIEW','HR READY'],11:['JOB CARD','TIMESHEETS','CERTIFICATES','PACKAGE'],12:['PORTAL','CERTIFICATES','MPI / NDT','REPORTS'],13:['SLAMM','RISK ASSESSMENT','REPORTING','AUDIT TRAIL'],14:['CUSTOMER','INSPECTOR','MANAGER','ADMIN'],15:['PLAN','EXECUTE','INSPECT','APPROVE','REPORT'],16:['ONE PLATFORM','ONE WORKFLOW','CLEAR EVIDENCE']}
    arr=labels[i]; y=610; x=90
    for j,label in enumerate(arr):
        color=GREEN if j==len(arr)-1 else BLUE; w=pill(d,(x,y),label,color); x+=w+22
        if x>1690: x=90; y+=82
    if i not in (1,16): card(d,(90,790,1830,945),'CONNECTED RECORD',SCENES[i-1][3],GREEN if i in (7,15) else BLUE)
    im.save(FRAMES/f'scene-{i:02d}.png')

for i,s in enumerate(SCENES,1): make_frame(i,*s[:3])
(OUT/'ATEC-Platform-Overview-Narration.txt').write_text('\n\n'.join(f'{i:02d}. {s[3]}' for i,s in enumerate(SCENES,1)),encoding='utf-8')
print(f'Created {len(SCENES)} frames and narration script in {OUT}')
