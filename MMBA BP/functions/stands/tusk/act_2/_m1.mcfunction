# --- Tusk Act 2 primary nail (fire 0.45s = F9, interval 0.35s = I7, L=16) -- see scripts/stands/tusk/TUSK.md
# click
scoreboard players add @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] m1 1
scoreboard players set @s[scores={m1=3..}] m1 2
tag @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] add tusk_shot_queued
playanimation @s[scores={sp1=19,m1=1,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] animation.tusk2.nail
playanimation @s[scores={sp1=19,m1=2,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] animation.tusk2.nail2
execute as @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] at @s run playsound xvoid.steelball_turn2 @a[r=20] ~~~ 0.8 0.95
execute as @s[scores={sp1=19,m1=1,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] at @s run playsound johnny.skill_21 @a[r=20] ~~~ 0.85 1.0
execute as @s[scores={sp1=19,m1=2,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] at @s run playsound johnny.atkSS_02 @a[r=20] ~~~ 0.75 1.0
scoreboard players set @s[scores={sp1=19,nails=1..,sneak=0},tag=!onSkill,tag=!tusk_rotation] sp1 -16

# fire (sp1 == -I) — only when queued by an actual click
execute as @s[scores={sp1=-7,nails=1..},tag=tusk_shot_queued] at @s run playsound xvoid.hit_slash_M @a[r=20] ~~~ 1.0 1.0
execute as @s[scores={sp1=-7,nails=1..},tag=tusk_shot_queued] at @s run playsound xvoid.oramuda_button3 @a[r=20] ~~~ 0.8 1.05
camerashake add @s[scores={sp1=-7,nails=1..},tag=tusk_shot_queued] 0.2 0.1
execute as @s[scores={sp1=-7,nails=1..},tag=tusk_shot_queued] at @s run scriptevent xvoid:tusk_shot primary 2
tag @s[scores={sp1=-7}] remove tusk_shot_queued

# open spam window before sp1 reaches 0 (0 wipes m1)
scoreboard players set @s[scores={sp1=-1,m1=1..}] sp1 8
tag @s[scores={sp1=0}] remove tusk_shot_queued
