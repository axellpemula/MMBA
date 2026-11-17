# --- twau -----------
execute as @a[scores={standC=2},hasitem={item=jjba:stand,location=slot.weapon.mainhand},tag=!blocking,tag=!clashing,tag=!twau_tandem] at @s run function stands/twau/_m1
execute as @a[scores={standC=2,onground=0},tag=chargeT,tag=!onSkill,tag=!twau_tandem] at @s run tag @s add high
tag @a[scores={standC=2,onground=0},tag=high,tag=!onSkill] remove chargeT
execute as @a[scores={standC=2},tag=chargeT,tag=!twau_tandem] at @s run function stands/twau/heavy
execute as @a[scores={standC=2},tag=low,tag=!twau_tandem] at @s run function stands/twau/low
execute as @a[scores={standC=2},tag=high,tag=!twau_tandem] at @s run function stands/twau/high
execute as @a[scores={standC=2},tag=chargeM,tag=!twau_tandem] at @s run function stands/twau/barrage
execute as @a[scores={standC=2},tag=chargeTB,tag=!onSkill,tag=!tsed,tag=!twau_tandem] at @s run scriptevent xvoid:twau chop
execute as @a[scores={standC=2},tag=chargeMB,tag=!onSkill,tag=!tsed,tag=!twau_tandem] at @s run scriptevent xvoid:twau tandem
execute as @a[scores={standC=2},tag=chargeTSB,tag=!ts,tag=!ts_exhausted,tag=!twau_tandem] at @s run playsound diego.special_01 @a ~~~ 1.2 1
execute as @a[scores={standC=2},tag=chargeTSB,tag=!ts,tag=!ts_exhausted,tag=!twau_tandem] at @s run scriptevent ts:twau 100
execute as @a[scores={standC=2},tag=chargeMSB,tag=!ts,tag=!ts_exhausted,tag=!twau_tandem] at @s run playsound diego.special_01 @a ~~~ 1.2 1
execute as @a[scores={standC=2},tag=chargeMSB,tag=!ts,tag=!ts_exhausted,tag=!twau_tandem] at @s run scriptevent ts:twau 100
tag @a[scores={standC=2},tag=twau_tandem] remove chargeT
tag @a[scores={standC=2},tag=twau_tandem] remove chargeM
tag @a[scores={standC=2},tag=twau_tandem] remove low
tag @a[scores={standC=2},tag=twau_tandem] remove high
tag @a[scores={standC=2}] remove chargeTB
tag @a[scores={standC=2}] remove chargeMB
tag @a[scores={standC=2}] remove chargeTSB
tag @a[scores={standC=2}] remove chargeMSB

# --- tusk base -----------
execute as @a[scores={standC=1,act=0..2},hasitem={item=jjba:stand,location=slot.weapon.mainhand},tag=!blocking,tag=!clashing] at @s run function stands/tusk/_m1Johnny
execute as @a[scores={standC=1,act=0..2},tag=low] at @s run function stands/tusk/lowJohnny
execute as @a[scores={standC=1,act=0..2},tag=chargeT,tag=!barrageJohnny] at @s run function stands/tusk/heavyJohnny
execute as @a[scores={standC=1,act=0..2},tag=chargeM,tag=!heavyJohnny] at @s run function stands/tusk/barrageJohnny
# --- act 1 base -----------
execute as @a[scores={standC=1,act=0},hasitem={item=jjba:stand2,location=slot.weapon.mainhand},tag=!blocking,tag=!clashing] at @s run function stands/tusk/act_1/_m1
# --- tusk act 2 -----------
execute as @a[scores={standC=1,act=1},hasitem={item=jjba:stand2,location=slot.weapon.mainhand},tag=!blocking,tag=!clashing] at @s run function stands/tusk/act_2/_m1
# --- tusk act 3 -----------
execute as @a[scores={standC=1,act=2},hasitem={item=jjba:stand2,location=slot.weapon.mainhand},tag=!blocking,tag=!clashing] at @s run function stands/tusk/act_3/_m1
# --- tusk act 4 -----------
execute as @a[scores={standC=1,act=3},tag=chargeM] at @s run function stands/tusk/barrage

# --- d4c -----------
execute as @a[scores={standC=3},hasitem={item=jjba:stand,location=slot.weapon.mainhand},tag=!blocking,tag=!clashing] at @s run function stands/d4c/_m1
execute as @a[scores={standC=3},tag=chargeT] at @s run function stands/d4c/heavy
execute as @a[scores={standC=3},tag=low] at @s run function stands/d4c/low
execute as @a[scores={standC=3},tag=high] at @s run function stands/d4c/high
execute as @a[scores={standC=3},tag=chargeM] at @s run function stands/d4c/barrage

# -- mandom -----------
execute as @a[scores={standC=4},tag=chargeTB,tag=!onSkill,tag=!blocking,tag=!clashing] at @s run scriptevent xvoid:mandom_skill clock_toggle
execute as @a[scores={standC=4},tag=chargeMB,tag=!onSkill,tag=!blocking,tag=!clashing] at @s run scriptevent xvoid:mandom_skill clock_toggle
execute as @a[scores={standC=4},tag=chargeTSB,tag=!onSkill,tag=!tsed,tag=!blocking,tag=!clashing] at @s run scriptevent xvoid:mandom_skill rewind
execute as @a[scores={standC=4},tag=chargeMSB,tag=!onSkill,tag=!tsed,tag=!blocking,tag=!clashing] at @s run scriptevent xvoid:mandom_skill rewind
tag @a[scores={standC=4}] remove chargeTB
tag @a[scores={standC=4}] remove chargeMB
tag @a[scores={standC=4}] remove chargeTSB
tag @a[scores={standC=4}] remove chargeMSB

# -- boku (oyecomova) -----------
execute as @a[scores={standC=5},tag=chargeTB,tag=!onSkill,tag=!tsed,tag=!blocking,tag=!clashing] at @s run scriptevent xvoid:boku smoke
execute as @a[scores={standC=5},tag=chargeMB,tag=!onSkill,tag=!tsed,tag=!blocking,tag=!clashing] at @s run scriptevent xvoid:boku smoke
execute as @a[scores={standC=5},tag=chargeTSB,tag=!onSkill,tag=!tsed,tag=!blocking,tag=!clashing] at @s run scriptevent xvoid:boku kick
execute as @a[scores={standC=5},tag=chargeMSB,tag=!onSkill,tag=!tsed,tag=!blocking,tag=!clashing] at @s run scriptevent xvoid:boku kick
tag @a[scores={standC=5}] remove chargeTB
tag @a[scores={standC=5}] remove chargeMB
tag @a[scores={standC=5}] remove chargeTSB
tag @a[scores={standC=5}] remove chargeMSB

# -- oh lonesome me -----------
execute as @a[scores={standC=6},tag=chargeTB,tag=!tsed] at @s run function stands/tim/lasso_hook
execute as @a[scores={standC=6},tag=chargeTSB,tag=!tsed] at @s run function stands/tim/unravel
execute as @a[scores={standC=6},tag=chargeMB,tag=!tsed] at @s run function stands/tim/zipline_grapple
execute as @a[scores={standC=6},tag=chargeMSB,tag=!tsed] at @s run function stands/tim/unravel

# -- Scary Monsters -----------
execute as @a[scores={standC=12,act=0},hasitem={item=jjba:stand,location=slot.weapon.mainhand},tag=!blocking,tag=!clashing] at @s run function stands/sm/_m1
execute as @a[scores={standC=12,act=1},hasitem={item=jjba:stand,location=slot.weapon.mainhand},tag=!blocking,tag=!clashing] at @s run function stands/sm/dino/_m1
execute as @a[scores={standC=12,onground=0},tag=chargeT,tag=!onSkill] at @s run tag @s add high
execute as @a[scores={standC=12,onground=1},tag=chargeT,tag=!onSkill] at @s run tag @s add heavy
execute as @a[scores={standC=12,act=0},tag=high] at @s run function stands/sm/high
execute as @a[scores={standC=12,act=0},tag=heavy,tag=chargeT] at @s run function stands/sm/heavy
execute as @a[scores={standC=12,act=0},tag=low] at @s run function stands/sm/low
execute as @a[scores={standC=12,act=0},tag=chargeM] at @s run function stands/sm/barrage

# -- Standless / Non-Combat Stands / TWAU Tandem -----------
execute as @a[scores={standC=0},hasitem=[{item=jjba:stand,location=slot.weapon.mainhand},{item=xvoid:revolver,location=slot.weapon.mainhand,quantity=0},{item=xvoid:shotgun,location=slot.weapon.mainhand,quantity=0},{item=xvoid:tommy_gun,location=slot.weapon.mainhand,quantity=0},{item=jjba:ball,location=slot.weapon.mainhand,quantity=0},{item=jjba:wrecking_ball,location=slot.weapon.mainhand,quantity=0},{item=jjba:stand2,location=slot.weapon.mainhand,quantity=0}],tag=!blocking,tag=!clashing,tag=!onSkill] at @s run function stands/standless/_m1
execute as @a[scores={standC=4},hasitem=[{item=jjba:stand,location=slot.weapon.mainhand},{item=xvoid:revolver,location=slot.weapon.mainhand,quantity=0},{item=xvoid:shotgun,location=slot.weapon.mainhand,quantity=0},{item=xvoid:tommy_gun,location=slot.weapon.mainhand,quantity=0},{item=jjba:ball,location=slot.weapon.mainhand,quantity=0},{item=jjba:wrecking_ball,location=slot.weapon.mainhand,quantity=0},{item=jjba:stand2,location=slot.weapon.mainhand,quantity=0}],tag=!blocking,tag=!clashing,tag=!onSkill] at @s run function stands/standless/_m1
execute as @a[scores={standC=5..11},hasitem=[{item=jjba:stand,location=slot.weapon.mainhand},{item=xvoid:revolver,location=slot.weapon.mainhand,quantity=0},{item=xvoid:shotgun,location=slot.weapon.mainhand,quantity=0},{item=xvoid:tommy_gun,location=slot.weapon.mainhand,quantity=0},{item=jjba:ball,location=slot.weapon.mainhand,quantity=0},{item=jjba:wrecking_ball,location=slot.weapon.mainhand,quantity=0},{item=jjba:stand2,location=slot.weapon.mainhand,quantity=0}],tag=!blocking,tag=!clashing,tag=!onSkill,tag=!century_active,tag=!tim_unravel] at @s run function stands/standless/_m1
execute as @a[scores={standC=13..14},hasitem=[{item=jjba:stand,location=slot.weapon.mainhand},{item=xvoid:revolver,location=slot.weapon.mainhand,quantity=0},{item=xvoid:shotgun,location=slot.weapon.mainhand,quantity=0},{item=xvoid:tommy_gun,location=slot.weapon.mainhand,quantity=0},{item=jjba:ball,location=slot.weapon.mainhand,quantity=0},{item=jjba:wrecking_ball,location=slot.weapon.mainhand,quantity=0},{item=jjba:stand2,location=slot.weapon.mainhand,quantity=0}],tag=!blocking,tag=!clashing,tag=!onSkill] at @s run function stands/standless/_m1
execute as @a[scores={standC=2},tag=twau_tandem,hasitem=[{item=jjba:stand,location=slot.weapon.mainhand},{item=xvoid:revolver,location=slot.weapon.mainhand,quantity=0},{item=xvoid:shotgun,location=slot.weapon.mainhand,quantity=0},{item=xvoid:tommy_gun,location=slot.weapon.mainhand,quantity=0},{item=jjba:ball,location=slot.weapon.mainhand,quantity=0},{item=jjba:wrecking_ball,location=slot.weapon.mainhand,quantity=0},{item=jjba:stand2,location=slot.weapon.mainhand,quantity=0}],tag=!blocking,tag=!clashing,tag=!onSkill] at @s run function stands/standless/_m1

tag @a[scores={standC=0,onground=0},tag=chargeT,tag=!onSkill] add high
tag @a[scores={standC=0,onground=0},tag=chargeT,tag=!onSkill] remove chargeT
tag @a[scores={standC=4,onground=0},tag=chargeT,tag=!onSkill] add high
tag @a[scores={standC=4,onground=0},tag=chargeT,tag=!onSkill] remove chargeT
tag @a[scores={standC=5..11,onground=0},tag=chargeT,tag=!onSkill,tag=!century_active,tag=!tim_unravel] add high
tag @a[scores={standC=5..11,onground=0},tag=chargeT,tag=!onSkill,tag=!century_active,tag=!tim_unravel] remove chargeT
tag @a[scores={standC=13..14,onground=0},tag=chargeT,tag=!onSkill] add high
tag @a[scores={standC=13..14,onground=0},tag=chargeT,tag=!onSkill] remove chargeT

tag @a[scores={standC=0,onground=1},tag=chargeT,tag=!onSkill] add heavy
tag @a[scores={standC=4,onground=1},tag=chargeT,tag=!onSkill] add heavy
tag @a[scores={standC=5..11,onground=1},tag=chargeT,tag=!onSkill,tag=!century_active,tag=!tim_unravel] add heavy
tag @a[scores={standC=13..14,onground=1},tag=chargeT,tag=!onSkill] add heavy

tag @a[scores={standC=0},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing] add heavy
tag @a[scores={standC=0},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing] add chargeT
tag @a[scores={standC=0},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing] remove chargeM
tag @a[scores={standC=4},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing] add heavy
tag @a[scores={standC=4},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing] add chargeT
tag @a[scores={standC=4},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing] remove chargeM
tag @a[scores={standC=5..11},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing,tag=!century_active,tag=!tim_unravel] add heavy
tag @a[scores={standC=5..11},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing,tag=!century_active,tag=!tim_unravel] add chargeT
tag @a[scores={standC=5..11},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing,tag=!century_active,tag=!tim_unravel] remove chargeM
tag @a[scores={standC=13..14},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing] add heavy
tag @a[scores={standC=13..14},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing] add chargeT
tag @a[scores={standC=13..14},tag=chargeM,tag=!onSkill,tag=!blocking,tag=!clashing] remove chargeM

execute as @a[scores={standC=0},tag=heavy,tag=chargeT,tag=!blocking,tag=!clashing] at @s run function stands/standless/heavy
execute as @a[scores={standC=4},tag=heavy,tag=chargeT,tag=!blocking,tag=!clashing] at @s run function stands/standless/heavy
execute as @a[scores={standC=5..11},tag=heavy,tag=chargeT,tag=!blocking,tag=!clashing,tag=!century_active,tag=!tim_unravel] at @s run function stands/standless/heavy
execute as @a[scores={standC=13..14},tag=heavy,tag=chargeT,tag=!blocking,tag=!clashing] at @s run function stands/standless/heavy

execute as @a[scores={standC=0},tag=low,tag=!blocking,tag=!clashing] at @s run function stands/standless/low
execute as @a[scores={standC=4},tag=low,tag=!blocking,tag=!clashing] at @s run function stands/standless/low
execute as @a[scores={standC=5..11},tag=low,tag=!blocking,tag=!clashing,tag=!century_active,tag=!tim_unravel] at @s run function stands/standless/low
execute as @a[scores={standC=13..14},tag=low,tag=!blocking,tag=!clashing] at @s run function stands/standless/low

execute as @a[scores={standC=0},tag=high,tag=!blocking,tag=!clashing] at @s run function stands/standless/high
execute as @a[scores={standC=4},tag=high,tag=!blocking,tag=!clashing] at @s run function stands/standless/high
execute as @a[scores={standC=5..11},tag=high,tag=!blocking,tag=!clashing,tag=!century_active,tag=!tim_unravel] at @s run function stands/standless/high
execute as @a[scores={standC=13..14},tag=high,tag=!blocking,tag=!clashing] at @s run function stands/standless/high

# Clean up active skill states if stunned or clashing
tag @a[tag=!onSkill] remove uncancelable
tag @a[tag=!onSkill] remove heavyJohnny
tag @a[tag=!onSkill] remove barrageJohnny
execute as @a[scores={stun=2..},tag=onSkill,tag=!uncancelable] at @s run scriptevent xvoid:damage stop
tag @a[scores={stun=2..},tag=!uncancelable] remove onSkill
tag @a[scores={stun=2..},tag=!uncancelable] remove chargeT
tag @a[scores={stun=2..},tag=!uncancelable] remove chargeM
tag @a[scores={stun=2..},tag=!uncancelable] remove heavyJohnny
tag @a[scores={stun=2..},tag=!uncancelable] remove barrageJohnny
tag @a[scores={stun=2..}] remove chargeTB
tag @a[scores={stun=2..}] remove chargeMB
tag @a[scores={stun=2..}] remove chargeTSB
tag @a[scores={stun=2..}] remove chargeMSB
tag @a[scores={stun=2..}] remove low
tag @a[scores={stun=2..}] remove high
tag @a[scores={stun=2..}] remove heavy