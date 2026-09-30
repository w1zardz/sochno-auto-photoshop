#target photoshop
/* SOCHNO AUTO 2.1 | Adaptive color grading and thumbnail finishing for Photoshop.
   Per-image analysis drives Camera Raw; full-resolution masks keep each effect where it helps;
   a quality gate measures the real Photoshop render and retunes it.
   Local, self-contained ExtendScript. RGB 8/16-bit. No network or paid plugins.
   One run = one undo step. Regenerates its own group from the unprocessed source.
   Copyright 2026. You may use and modify this script for any of your projects. */
var SOCHNO = (function () {
    var api = {}, C = charIDToTypeID, S = stringIDToTypeID;
    var PREFIX = 'SOCHNO AUTO', MARKER = 'SOCHNO_SOURCE_v1', TAG = 'SOCHNO_', PASSES = 3;
    function clamp(x,a,b) { return Math.max(a,Math.min(b,x)); }
    function round(x) { return Math.round(x); }
    function ramp(x,a,b) { return clamp((x-a)/(b-a),0,1); }
    function hue(c,mx,mn) {
        var delta=mx-mn;if(delta<.00001)return 0;
        // ExtendScript associates chained conditional expressions differently from modern JS.
        var h;
        if(mx===c[0])h=(c[1]-c[2])/delta;
        else if(mx===c[1])h=2+(c[2]-c[0])/delta;
        else h=4+(c[0]-c[1])/delta;
        return (h*60+360)%360;
    }
    function activeRGB(d) { app.activeDocument=d; d.activeChannels=d.componentChannels; }
    function close(d) { if(d) { try { d.close(SaveOptions.DONOTSAVECHANGES); } catch(e) {} } }
    function total(hist) { var n=0; for(var i=0;i<256;i++)n+=hist[i]; return n; }
    function q(hist,n,p) { var s=0; for(var i=0;i<256;i++) {s+=hist[i]; if(s>=n*p)return i/255;} return 1; }
    function frac(hist,lo,hi) { var n=total(hist),s=0; for(var i=lo;i<=hi;i++)s+=hist[i]; return n?s/n:0; }
    function mean(hist) { var n=total(hist),s=0; for(var i=0;i<256;i++)s+=i*hist[i]; return n?s/n/255:0; }
    function isOurs(g) {
        if(g.typename!=='LayerSet' || g.name.indexOf(PREFIX)!==0)return false;
        for(var i=0;i<g.artLayers.length;i++)if(g.artLayers[i].name===MARKER)return true;
        return false;
    }
    function findOurs(parent,arr) {
        for(var i=0;i<parent.layerSets.length;i++) {
            var g=parent.layerSets[i];
            if(isOurs(g))arr.push({layer:g,id:g.id,visible:g.visible}); else findOurs(g,arr);
        }
    }
    function findNamedGroup(parent,name) {
        for(var i=0;i<parent.layerSets.length;i++) {
            var g=parent.layerSets[i];if(g.name===name)return g;
            var found=findNamedGroup(g,name);if(found)return found;
        }
        return null;
    }
    function selectLayerId(doc,id) {
        app.activeDocument=doc;var d=new ActionDescriptor(),r=new ActionReference();
        r.putIdentifier(C('Lyr '),id);d.putReference(C('null'),r);d.putBoolean(C('MkVs'),false);
        executeAction(C('slct'),d,DialogModes.NO);return doc.activeLayer;
    }
    function deleteLayerId(id) {
        var d=new ActionDescriptor(),r=new ActionReference();r.putIdentifier(C('Lyr '),id);d.putReference(C('null'),r);
        executeAction(C('Dlt '),d,DialogModes.NO);
    }
    function isArtboard(l) {
        if(l.typename!=='LayerSet')return false;
        var r=new ActionReference(); r.putIdentifier(C('Lyr '),l.id);
        var d=executeActionGet(r);
        return d.hasKey(S('artboardEnabled')) && d.getBoolean(S('artboardEnabled'));
    }
    // Read a temporary 24-bit BMP; avoids thousands of slow Photoshop color samplers.
    function pixels(doc,maxSide) {
        var t=null, file=File(Folder.temp+'/sochno_'+new Date().getTime()+'_'+round(Math.random()*1e8)+'.bmp');
        try {
            t=doc.duplicate('SOCHNO analysis',true); activeRGB(t); t.selection.deselect();
            t.flatten();
            if(t.colorProfileName!=='sRGB IEC61966-2.1')t.convertProfile('sRGB IEC61966-2.1',Intent.RELATIVECOLORIMETRIC,true,false);
            t.bitsPerChannel=BitsPerChannelType.EIGHT;
            var scale=Math.min(1,maxSide/Math.max(t.width.as('px'),t.height.as('px')));
            if(scale<1)t.resizeImage(UnitValue(round(t.width.as('px')*scale),'px'),UnitValue(round(t.height.as('px')*scale),'px'),null,ResampleMethod.BICUBIC);
            var options=new BMPSaveOptions(); options.depth=BMPDepthType.TWENTYFOUR;
            options.alphaChannels=false; options.rleCompression=false;
            t.saveAs(file,options,true,Extension.LOWERCASE);
            file.encoding='BINARY'; if(!file.open('r'))throw Error('Не удалось прочитать временный анализ.');
            var data=file.read(); file.close();
            function u16(n) {return data.charCodeAt(n)+(data.charCodeAt(n+1)<<8);}
            function u32(n) {return (data.charCodeAt(n)+(data.charCodeAt(n+1)<<8)+(data.charCodeAt(n+2)<<16)+data.charCodeAt(n+3)*16777216);}
            var off=u32(10),w=u32(18),rawH=u32(22),h=rawH>2147483647?4294967296-rawH:rawH;
            if(data.substr(0,2)!=='BM'||u16(28)!==24||u32(30)!==0||!w||!h)throw Error('Неподдерживаемый формат анализа BMP.');
            var stride=Math.floor((w*3+3)/4)*4,arr=new Array(w*h),ys=new Array(w*h);
            if(off+stride*h>data.length)throw Error('Неполный файл анализа.');
            for(var y=0;y<h;y++)for(var x=0;x<w;x++) {
                var p=off+(rawH>2147483647?y:h-1-y)*stride+x*3;
                var b=data.charCodeAt(p)/255,g=data.charCodeAt(p+1)/255,r=data.charCodeAt(p+2)/255;
                arr[y*w+x]=[r,g,b]; ys[y*w+x]=.2126*r+.7152*g+.0722*b;
            }
            return {rgb:arr,y:ys,w:w,h:h};
        } finally {try{file.close();file.remove();}catch(e){} close(t); app.activeDocument=doc;}
    }
    function stats(px) {
        var n=px.rgb.length,h=[],sum=0,sat=0,hot=0,white=0,black=0,colorClip=0,shadow=0,light=0,edge=0,ec=0,res=[],resCount=0;
        var bands=[],neutral=[0,0,0],neutralN=0,chroma=0,colorful=0,skin=0,flat=0,interior=0,foliage=0;
        for(var bi=0;bi<6;bi++)bands.push({count:0,saturation:0,hot:0,clip:0});
        for(var i=0;i<256;i++)h[i]=0;
        for(i=0;i<n;i++) {
            var c=px.rgb[i],y=px.y[i],mx=Math.max(c[0],c[1],c[2]),mn=Math.min(c[0],c[1],c[2]);
            var s=mx>0?(mx-mn)/mx:0;
            chroma+=mx-mn;
            if(s>.12&&y>.06&&y<.94) {
                var hh=hue(c,mx,mn),band=bands[Math.floor((hh+30)/60)%6];
                band.count++;band.saturation+=s;
                if(s>.9)band.hot++;
                if(mx>=.995)band.clip++;
                if(s>.25)colorful++;
                // Skin-like: warm hue, moderate saturation, mid lightness. Gold is usually more saturated.
                if(hh>=8&&hh<=45&&s>.18&&s<.6&&y>.25&&y<.85)skin++;
                // Grass and leaves: yellow-green of moderate saturation. Vibrance lifts exactly these
                // mid-saturated tones most and turns them acid; saturated yellow titles are not counted.
                if(hh>=45&&hh<=150&&s<.72&&y>.12&&y<.8)foliage++;
            }
            // Conservative neutral candidates only; colored scenery is not a white reference.
            if(s<.16&&y>.25&&y<.85) {
                for(var ci=0;ci<3;ci++)neutral[ci]+=c[ci]-y;
                neutralN++;
            }
            h[clamp(round(y*255),0,255)]++;sum+=y;sat+=s;
            if(s>.9&&y>.06)hot++;
            if(mn>=.985)white++;
            if(mx<=.015)black++;
            if(mx>=.995&&s>.25)colorClip++;
            if(y>.015&&y<.25)shadow++;
            if(y>.84&&y<.985)light++;
            var xx=i%px.w,yy=Math.floor(i/px.w);
            if(xx>1&&yy>1&&xx<px.w-2&&yy<px.h-2) {
                var l=px.y[i-1],r=px.y[i+1],u=px.y[i-px.w],d=px.y[i+px.w];
                edge+=Math.abs(y-r)+Math.abs(y-d);ec+=2;interior++;
                var range=Math.max(l,r,u,d)-Math.min(l,r,u,d);
                // Flat fills (UI plates, text, map areas) mark graphic rather than photographic content.
                if(range<.012)flat++;
                if(range<.055&&y>.05&&y<.9)res[resCount++]=Math.abs(y-(l+r+u+d)/4);
            }
        }
        res.sort(function(a,b){return a-b;});
        for(bi=0;bi<6;bi++) {
            var b=bands[bi],bn=Math.max(1,b.count);
            b.saturation/=bn;b.hot/=bn;b.clip/=bn;b.share=b.count/n;
        }
        for(ci=0;ci<3;ci++)neutral[ci]/=Math.max(1,neutralN);
        return {mean:sum/n,median:q(h,n,.5),p05:q(h,n,.05),p10:q(h,n,.1),p90:q(h,n,.9),p95:q(h,n,.95),
            saturation:sat/n,hot:hot/n,white:white/n,black:black/n,colorClip:colorClip/n,shadows:shadow/n,highlights:light/n,
            edge:ec?edge/ec:0,flat:interior?flat/interior:0,noise:res.length>50?res[Math.floor(res.length*.65)]:0,noiseSamples:res.length,
            bands:bands,neutral:neutral,neutralShare:neutralN/n,chroma:chroma/n,colorful:colorful/n,skin:skin/n,foliage:foliage/n,
            title:titleBox(px)};
    }
    // The main title: bright white or saturated letters with a dark outline or shadow right next to them.
    // Clouds and glare are bright too, but have no dark edge. Rows are grouped into bands; the band with
    // the most letter pixels is the title. Returns its box (fractions of the frame) and backdrop brightness.
    function titleBox(px) {
        var w=px.w,h=px.h,n=w*h,rows=[],pts=[],x,y,i;
        for(y=0;y<h;y++)rows[y]=0;
        for(i=0;i<n;i++) {
            var c=px.rgb[i],l=px.y[i],mx=Math.max(c[0],c[1],c[2]),mn=Math.min(c[0],c[1],c[2]);
            if(l<=.72||!(mn>.85||(mx-mn)/mx>.5))continue;
            x=i%w;y=Math.floor(i/w);
            var edge=false;
            for(var dy=-2;dy<=2&&!edge;dy++)for(var dx=-2;dx<=2;dx++) {
                var xx=x+dx,yy=y+dy;
                if(xx>=0&&yy>=0&&xx<w&&yy<h&&px.y[yy*w+xx]<l-.5){edge=true;break;}
            }
            if(edge){rows[y]++;pts.push([x,y]);}
        }
        // Bands of rows with letters; gaps up to two rows are line spacing.
        var best=null,cur=null,gap=0;
        for(y=0;y<=h;y++) {
            if(y<h&&rows[y]>0){if(!cur)cur={y0:y,y1:y,count:0};cur.y1=y;cur.count+=rows[y];gap=0;}
            else if(cur&&(y===h||++gap>2)){if(!best||cur.count>best.count)best=cur;cur=null;gap=0;}
        }
        if(!best||best.count<n*.004)return null;
        var xs=[];for(i=0;i<pts.length;i++)if(pts[i][1]>=best.y0&&pts[i][1]<=best.y1)xs.push(pts[i][0]);
        xs.sort(function(a,b){return a-b;});
        var x0=xs[Math.floor(xs.length*.03)],x1=xs[Math.min(xs.length-1,Math.floor(xs.length*.97))];
        // Backdrop: median of a ring around the title box. Inside the box outlines and shadows of the
        // letters dominate; the ring is the ground the title actually has to stand out from.
        var mx0=Math.max(2,round(w*.05)),my0=Math.max(2,round(h*.06));
        var bx0=Math.max(0,x0-mx0),bx1=Math.min(w-1,x1+mx0),by0=Math.max(0,best.y0-my0),by1=Math.min(h-1,best.y1+my0);
        var bg=[];
        for(y=by0;y<=by1;y++)for(x=bx0;x<=bx1;x++) {
            if(x>=x0&&x<=x1&&y>=best.y0&&y<=best.y1)continue;
            var v=px.y[y*w+x];if(v<=.72)bg.push(v);
        }
        bg.sort(function(a,b){return a-b;});
        return {x0:x0/w,y0:best.y0/h,x1:(x1+1)/w,y1:(best.y1+1)/h,share:best.count/n,backdrop:bg.length?bg[Math.floor(bg.length/2)]:0};
    }
    // ---- Full-resolution maps. Photoshop computes them natively; the script only reads histograms.
    function chRef(name,docName) {
        var r=new ActionReference(),e={RGB:'RGB ',R:'Rd  ',G:'Grn ',B:'Bl  ',MASK:'Msk '}[name];
        if(e)r.putEnumerated(C('Chnl'),C('Chnl'),C(e)); else r.putName(C('Chnl'),TAG+name);
        if(docName)r.putName(C('Dcmn'),docName);
        return r;
    }
    function selectChannel(name) {
        var d=new ActionDescriptor();d.putReference(C('null'),chRef(name));d.putBoolean(C('MkVs'),false);
        executeAction(C('slct'),d,DialogModes.NO);
    }
    function applyImage(src,mode,scale,opacity,docName) {
        var d=new ActionDescriptor(),s=new ActionDescriptor();s.putReference(C('T   '),chRef(src,docName));
        s.putEnumerated(C('Clcl'),C('Clcn'),C(mode));if(scale){s.putDouble(C('Scl '),scale);s.putInteger(C('Ofst'),0);}
        if(opacity)s.putUnitDouble(C('Opct'),C('#Prc'),opacity);
        d.putObject(C('With'),C('Clcl'),s);executeAction(C('AppI'),d,DialogModes.NO);
    }
    // Skin-tone Color Range stored into a new channel; returns its coverage (0..1).
    function skinRange(doc,name,faces) {
        channel(doc,name);selectChannel('RGB');
        try {
            var d=new ActionDescriptor();d.putInteger(C('Fzns'),20);d.putEnumerated(C('Clrs'),C('Clrs'),S('skinTone'));
            d.putBoolean(S('UseFacesKey'),faces);executeAction(C('ClrR'),d,DialogModes.NO);
            doc.selection.store(doc.channels.getByName(TAG+name),SelectionType.REPLACE);
        } catch(nothing) {}
        doc.selection.deselect();
        return mean(histogram(doc,name));
    }
    // Alpha channels via Action Manager: several times faster than the DOM collection.
    function channel(doc,name,src,mode) {
        var d=new ActionDescriptor();
        if(src&&!mode&&src!=='RGB') {
            d.putReference(C('null'),chRef(src));d.putString(C('Nm  '),TAG+name);executeAction(C('Dplc'),d,DialogModes.NO);
            selectChannel(name);return;
        }
        var c=new ActionDescriptor(),clr=new ActionDescriptor();
        c.putString(C('Nm  '),TAG+name);c.putEnumerated(C('ClrI'),C('MskI'),C('MskA'));
        clr.putDouble(C('Rd  '),255);clr.putDouble(C('Grn '),0);clr.putDouble(C('Bl  '),0);c.putObject(C('Clr '),C('RGBC'),clr);c.putInteger(C('Opct'),50);
        d.putObject(C('Nw  '),C('Chnl'),c);executeAction(C('Mk  '),d,DialogModes.NO);
        selectChannel(name);if(src)applyImage(src,mode||'Nrml');
    }
    // Curves on the targeted channel (alpha channel or layer mask).
    function curve(points) {
        var d=new ActionDescriptor(),list=new ActionList(),ch=new ActionDescriptor(),r=new ActionReference(),pl=new ActionList();
        d.putEnumerated(S('presetKind'),S('presetKindType'),S('presetKindCustom'));
        r.putEnumerated(C('Chnl'),C('Ordn'),C('Trgt'));ch.putReference(C('Chnl'),r);
        for(var i=0;i<points.length;i++){var pt=new ActionDescriptor();pt.putDouble(C('Hrzn'),points[i][0]);pt.putDouble(C('Vrtc'),points[i][1]);pl.putObject(C('Pnt '),pt);}
        ch.putList(C('Crv '),pl);list.putObject(C('CrvA'),ch);d.putList(C('Adjs'),list);
        executeAction(C('Crvs'),d,DialogModes.NO);
    }
    // Levels input range on the targeted channel: values <= black become 0, values >= white become 255.
    function levels(black,white) {
        var d=new ActionDescriptor(),list=new ActionList(),ch=new ActionDescriptor(),r=new ActionReference(),input=new ActionList();
        d.putEnumerated(S('presetKind'),S('presetKindType'),S('presetKindCustom'));
        r.putEnumerated(C('Chnl'),C('Ordn'),C('Trgt'));ch.putReference(C('Chnl'),r);
        input.putInteger(black);input.putInteger(white);ch.putList(C('Inpt'),input);
        list.putObject(C('LvlA'),ch);d.putList(C('Adjs'),list);
        executeAction(C('Lvls'),d,DialogModes.NO);
    }
    function filter(id,radius) {var d=new ActionDescriptor();d.putUnitDouble(C('Rds '),C('#Pxl'),radius);executeAction(C(id),d,DialogModes.NO);}
    function histogram(doc,name) {var c=doc.channels.getByName(TAG+name),v=c.visible;c.visible=true;var h=c.histogram;c.visible=v;return h;}
    function removeChannels(names) {
        for(var i=0;i<names.length;i++){try{var d=new ActionDescriptor();d.putReference(C('null'),chRef(names[i]));executeAction(C('Dlt '),d,DialogModes.NO);}catch(e){}}
    }
    function buildMasks(doc,s) {
        activeRGB(doc);doc.selection.deselect();
        var sc=clamp(doc.width.as('px')/1280,.25,6),noisy=clamp((s.noise-.004)/.02,0,1);
        channel(doc,'LUM','RGB');
        channel(doc,'MAX','R');applyImage('G','Lghn');applyImage('B','Lghn');
        channel(doc,'MIN','R');applyImage('G','Drkn');applyImage('B','Drkn');
        channel(doc,'CHR','MAX');applyImage('MIN','Sbtr',1);
        // DET: areas with in-focus fine detail. |high-pass| is a V curve around 128 with a noise floor;
        // the blur turns edges into regions. Bokeh, skies, skin and flat fills stay out of the detail layer.
        channel(doc,'DET','LUM');filter('HghP',Math.max(.5,1.2*sc));
        var lo=3+6*noisy,hi=22+10*noisy;
        curve([[0,255],[128-hi,255],[128-lo,0],[128+lo,0],[128+hi,255],[255,255]]);
        filter('GsnB',8*sc);curve([[0,0],[20,0],[90,255],[255,255]]);
        // NEU: nearly neutral mid and light tones (white cars, text, UI plates). Layer 05 cleans their tint.
        channel(doc,'NEU','CHR');curve([[0,255],[6,255],[20,0],[255,0]]);
        channel(doc,'TMP','LUM');curve([[0,0],[90,0],[150,255],[255,255]]);
        selectChannel('NEU');applyImage('TMP','Mltp');filter('GsnB',Math.max(.5,sc));
        // SKIN: Photoshop's skin-tone range with face detection. Without faces it marks every warm tone
        // (gold, wood, warm whites), so the mask is kept only when face detection clearly narrows it.
        var withFaces=skinRange(doc,'SKIN',true),anyWarm=skinRange(doc,'SKN2',false);
        s.faces=withFaces>.002&&withFaces<anyWarm*.8?withFaces:0;
        removeChannels(s.faces?['SKN2']:['SKN2','SKIN']);
        if(s.faces) {
            selectChannel('SKIN');filter('GsnB',Math.max(.5,1.5*sc));
            // Skin keeps its own texture: half-strength detail on faces and hands.
            selectChannel('DET');applyImage('SKIN','Sbtr',1,50);
        }
        // COL: where the colour layers act. Nearly neutral surfaces of any brightness and skin are
        // excluded, so Vibrance cannot turn grey stone blue, whites pink or faces orange.
        channel(doc,'COL','CHR');curve([[0,0],[14,0],[42,255],[255,255]]);
        if(s.faces)applyImage('SKIN','Sbtr',1);
        filter('GsnB',Math.max(.5,1.5*sc));
        // FOL: grass and leaves — green above blue, moderate colour, not bright. Colour layers act there at
        // reduced strength, so foliage stays green instead of acid. Saturated or bright yellow (titles, gold)
        // is outside the mask and keeps full colour, as do reds and skies.
        channel(doc,'FOL','G');applyImage('B','Sbtr',1);curve([[0,0],[18,0],[60,255],[255,255]]);
        channel(doc,'FCH','CHR');curve([[0,255],[120,255],[190,0],[255,0]]);
        channel(doc,'FLU','LUM');curve([[0,255],[185,255],[215,0],[255,0]]);
        selectChannel('FOL');applyImage('FCH','Mltp');applyImage('FLU','Mltp');filter('GsnB',Math.max(.5,2*sc));
        s.foliageMask=mean(histogram(doc,'FOL'));
        selectChannel('COL');applyImage('FOL','Sbtr',1,55);
        removeChannels(['FOL','FCH','FLU']);
        // HALO: soft backdrop around the title letters. Letters are bright pixels with a dark outline within a
        // few pixels, kept only inside the title band that the analysis found; the halo is their dilated blur.
        if(s.title) {
            var W=doc.width.as('px'),H=doc.height.as('px'),t=s.title;
            channel(doc,'TBR','LUM');curve([[0,0],[175,0],[200,255],[255,255]]);
            channel(doc,'TDK','LUM');filter('Mnm ',Math.max(1,3*sc));curve([[0,255],[60,255],[100,0],[255,0]]);
            selectChannel('TBR');applyImage('TDK','Mltp');
            var x0=Math.max(0,round((t.x0-.02)*W)),x1=Math.min(W,round((t.x1+.02)*W)),y0=Math.max(0,round((t.y0-.03)*H)),y1=Math.min(H,round((t.y1+.03)*H));
            var black=new SolidColor();black.rgb.red=black.rgb.green=black.rgb.blue=0;
            doc.selection.select([[x0,y0],[x1,y0],[x1,y1],[x0,y1]]);doc.selection.invert();doc.selection.fill(black);doc.selection.deselect();
            channel(doc,'HALO','TBR');filter('Mxm ',Math.max(1,10*sc));filter('GsnB',Math.max(1,14*sc));curve([[0,0],[100,255],[255,255]]);
            s.titleMask=mean(histogram(doc,'HALO'));
            removeChannels(['TBR','TDK']);
            if(s.titleMask<.005){removeChannels(['HALO']);s.title=null;}
        }
        // ROOM masks (RHI, RWH, RLO) are built by the first measure(), in the same sRGB as every measurement.
        removeChannels(['TMP','MAX','MIN','CHR','LUM']);
        activeRGB(doc);
    }
    // Region metrics by channel arithmetic (mask × thresholded channel), without loading selections.
    function hasChannel(t,name) {try{t.channels.getByName(TAG+name);return true;}catch(e){return false;}}
    // Share of the whole frame inside a source mask whose channel value falls in [lo,hi] (lo=0 or hi=255).
    function regionFrac(t,mask,name,lo,hi) {
        if(!hasChannel(t,mask))return 0;
        channel(t,'QRY',name);
        // Levels is linear, so the threshold is exact; a steep Curves spline overshoots between its points.
        if(lo===0){levels(hi,hi+1);executeAction(C('Invr'),undefined,DialogModes.NO);} else levels(lo-1,lo);
        applyImage(mask,'Mltp');
        var h=histogram(t,'QRY'),s=0;removeChannels(['QRY']);
        for(var i=128;i<256;i++)s+=h[i];
        return s/total(h);
    }
    // Mean chroma weighted by a source mask, and the mask's share of the frame.
    function regionChroma(t,name) {
        if(!hasChannel(t,name))return {c:0,share:0};
        channel(t,'QRY','MCHR');applyImage(name,'Mltp');
        var weighted=mean(histogram(t,'QRY')),share=mean(histogram(t,name));removeChannels(['QRY']);
        return {c:share>.0005?weighted/share:0,share:share};
    }
    // Exact full-resolution metrics of the visible result, in sRGB like the YouTube export.
    // withRoom (the source measurement): also build the ROOM masks — where the source still had room before
    // black or white — and copy them into doc. They must come from the same sRGB conversion as the
    // measurements: masks built in a Display P3 document marked a saturated red car as "room", its
    // conversion to sRGB clipped, and the gate blamed the render and dimmed it to 20%.
    function measure(doc,withRoom) {
        var t=null,m={};
        try {
            t=doc.duplicate('SOCHNO measure',true);activeRGB(t);t.selection.deselect();t.flatten();
            if(t.colorProfileName!=='sRGB IEC61966-2.1')t.convertProfile('sRGB IEC61966-2.1',Intent.RELATIVECOLORIMETRIC,true,false);
            t.bitsPerChannel=BitsPerChannelType.EIGHT;
            var hl=t.histogram,n=total(hl);
            channel(t,'MMAX','R');applyImage('G','Lghn');applyImage('B','Lghn');
            channel(t,'MMIN','R');applyImage('G','Drkn');applyImage('B','Drkn');
            if(withRoom) {
                var room=['RHI','RWH','RLO'];
                channel(t,'RHI','MMAX');curve([[0,255],[234,255],[242,0],[255,0]]);
                channel(t,'RWH','MMIN');curve([[0,255],[234,255],[242,0],[255,0]]);
                channel(t,'RLO','MMAX');curve([[0,0],[8,0],[16,255],[255,255]]);
                app.activeDocument=doc;removeChannels(room);
                for(var ri=0;ri<room.length;ri++){channel(doc,room[ri]);applyImage(room[ri],'Nrml',0,0,t.name);}
                activeRGB(doc);app.activeDocument=t;
            }
            channel(t,'MCHR','MMAX');applyImage('MMIN','Sbtr',1);
            var hx=histogram(t,'MMAX'),hn=histogram(t,'MMIN'),hc=histogram(t,'MCHR');
            m.crush=frac(hx,0,4);m.clip=frac(hx,254,255);m.white=frac(hn,251,255);m.chroma=mean(hc);
            m.mean=mean(hl);m.p01=q(hl,n,.01);m.p50=q(hl,n,.5);m.p99=q(hl,n,.99);m.minP05=q(hn,n,.05);
            // Chroma of surfaces that should stay clean, measured inside the source masks.
            m.neutral=regionChroma(t,'NEU');m.skin=regionChroma(t,'SKIN');
            // Detail lost to black or white where the source still had room.
            m.lostShadows=regionFrac(t,'RLO','MMAX',0,4);m.lostColor=regionFrac(t,'RHI','MMAX',254,255);m.lostWhite=regionFrac(t,'RWH','MMIN',251,255);
        } finally {close(t);app.activeDocument=doc;}
        return m;
    }
    function decide(s,m,width) {
        var flat=clamp((.72-(s.p90-s.p10))/.5,0,1),rich=clamp((s.saturation-.32)/.4,0,1);
        var noisy=clamp((s.noise-.004)/.020,0,1),detailed=clamp((s.edge-.045)/.08,0,1);
        // Colourful artwork often has intentionally dark UI/backgrounds (neon, casino UI): do not wash them out.
        var density=rich*clamp((s.mean-.24)/.15,0,1);
        var presence=clamp((s.chroma-.008)/.055,0,1),vivid=ramp(s.chroma,.12,.45),graphic=ramp(s.flat,.25,.6);
        var colorful=ramp(s.colorful,.08,.35),neutralConfidence=clamp((s.neutralShare-.025)/.12,0,1);
        var hazy=ramp(m.minP05,.05,.2),base={},detail={},bands=[];
        // Thumbnails are bright by design: exposure only lifts dark images, it never dims.
        base.Ex12=Math.round(clamp((.42-s.mean)*1.2,0,.4)*(1-density)*100)/100;
        base.Cr12=round(12+14*flat-6*ramp(s.p90-s.p10,.8,.95));
        // Recover bright detail that is not clipped yet; white text, UI and glows keep their full brightness.
        base.Hi12=-round(clamp(40*s.highlights-10*m.clip,0,14)*(1-ramp(m.white,.01,.04)));
        base.Sh12=round(clamp(6+40*s.shadows+(s.mean<.33?8:0),4,34)*(1-.7*density));
        base.Wh12=m.p99<.9?round(clamp((.96-m.p99)*90,0,18)):0;
        base.Bk12=m.p01>.06?-round(clamp((m.p01-.03)*110,0,18)):round(clamp((m.crush-.03)*140,0,14));
        base.Dhze=round(2+12*hazy*(1-.5*rich));
        // Per-colour light: slightly denser blues and purples. Yellow-green toward clean green;
        // yellow itself is never shifted (gold, titles).
        base.HA_G=round(7*presence*ramp(s.bands[2].share,.01,.06));
        base.LA_B=round(-5*presence);base.LA_P=round(-4*presence);base.LA_A=round(-2*presence);
        // Barely cool shadows; a neutral cast is corrected only with enough near-neutral reference.
        base.STSH=225;base.STSS=round(5*presence);
        base.Temp=round(clamp(-(s.neutral[0]-s.neutral[2])*200,-4,4)*neutralConfidence);
        base.Tint=round(clamp((s.neutral[1]-(s.neutral[0]+s.neutral[2])/2)*200,-4,4)*neutralConfidence);
        detail.CrTx=round((34+16*flat-4*detailed-6*graphic)*(1-.6*noisy));
        detail.Cl12=round((18+10*flat-4*detailed-5*graphic)*(1-.4*noisy));
        detail.Shrp=round((40+16*(1-detailed))*(1-.5*noisy));
        detail.ShpR=Math.round(clamp(.75+.2*width/1280,.6,2)*10)/10;detail.ShpD=20;detail.ShpM=round(35+35*noisy);
        if(noisy>.3)detail['LNR ']=round(10+30*noisy);
        // Dull colour ranges get more, saturated or clipping ones less (never negative). Reds carry skin.
        // Lots of grass and leaves: less global Vibrance and gentler yellow and green ranges, so foliage does
        // not turn acid and compete with yellow titles. The FOL mask weakens colour on foliage itself as well.
        var leafy=ramp(s.foliage||0,.08,.3);
        for(var i=0;i<6;i++) {
            var b=s.bands[i],boost=6+18*ramp(.88-b.saturation,0,.6)-25*b.hot-15*b.clip;
            if(i===0)boost=Math.min(boost,12);
            if(i===1||i===2)boost=Math.min(boost,14-8*leafy);
            bands.push(round(clamp(boost,0,24)*presence));
        }
        // Title backdrop: the brighter the ground behind the letters, the more it is dimmed (up to about -0.45 EV).
        // A dark backdrop already separates the title and is left alone.
        var title=s.title&&s.title.backdrop>.3?{dim:Math.round((.12+.15*ramp(s.title.backdrop,.35,.65))*100)/100}:null;
        return {base:base,detail:detail,title:title,
            color:{vibrance:round((30+20*(1-vivid))*presence*(1-.35*leafy)),saturation:round(clamp(6+10*(1-vivid)-6*s.hot,0,14)*presence*(1-.3*leafy)),bands:bands},
            neutral:-round((40+25*ramp(m.neutral.c,.01,.04))*ramp(m.neutral.share,.002,.02)),
            // Upper bound for the measured chroma gain; muted images may gain more before looking painted.
            colorCeiling:.18+.25*(1-vivid)*(.5+.5*colorful),colorScale:1,presence:presence,passes:0,clipTries:0,guards:[],log:[]};
    }
    function merged(a,b) {
        var o={},k;for(k in a)if(a.hasOwnProperty(k))o[k]=a[k];
        for(k in b)if(b.hasOwnProperty(k))o[k]=b[k];
        return o;
    }
    // Camera Raw as a smart filter on the active smart object.
    function acr(settings) {
        var d=new ActionDescriptor();d.putString(C('CMod'),'Filter');d.putEnumerated(C('Sett'),C('Sett'),C('Cst '));
        for(var k in settings)if(settings.hasOwnProperty(k)&&isFinite(settings[k])) {
            // "||0" turns -0 into 0: Action Manager rejects negative zero as an invalid argument.
            if(k==='Ex12'||k==='ShpR')d.putDouble(C(k),settings[k]||0); else d.putInteger(C(k),round(settings[k])||0);
        }
        try{executeAction(S('Adobe Camera Raw Filter'),d,DialogModes.NO);}
        catch(e){throw Error('Не удалось применить Camera Raw Filter. Проверь, что он есть в меню Фильтр → Camera Raw.\n'+e.message);}
    }
    function adjustment(name,type,settings) {
        var d=new ActionDescriptor(),r=new ActionReference(),u=new ActionDescriptor();
        r.putClass(S('adjustmentLayer')); d.putReference(C('null'),r);u.putString(C('Nm  '),name);
        u.putObject(C('Type'),type,settings);d.putObject(C('Usng'),S('adjustmentLayer'),u);
        executeAction(C('Mk  '),d,DialogModes.NO);return app.activeDocument.activeLayer;
    }
    // Copy a full-resolution map into the active layer's mask.
    function maskFrom(name,hasMask) {
        if(!hasMask) {
            var d=new ActionDescriptor(),r=new ActionReference();d.putClass(C('Nw  '),C('Chnl'));
            r.putEnumerated(C('Chnl'),C('Chnl'),C('Msk '));d.putReference(C('At  '),r);d.putEnumerated(C('Usng'),C('UsrM'),C('RvlA'));
            executeAction(C('Mk  '),d,DialogModes.NO);
        }
        selectChannel('MASK');applyImage(name,'Nrml');selectChannel('RGB');
    }
    // Blend If on the active layer: "This layer" sliders (b0..w1) and "Underlying layer" sliders (u, optional).
    function blendIf(b0,b1,w0,w1,u) {
        u=u||[0,0,255,255];
        var d=new ActionDescriptor(),r=new ActionReference(),layer=new ActionDescriptor(),list=new ActionList(),range=new ActionDescriptor(),ch=new ActionReference();
        r.putEnumerated(C('Lyr '),C('Ordn'),C('Trgt'));d.putReference(C('null'),r);
        ch.putEnumerated(C('Chnl'),C('Chnl'),C('Gry '));range.putReference(C('Chnl'),ch);
        range.putInteger(C('SrcB'),b0);range.putInteger(C('Srcl'),b1);range.putInteger(C('SrcW'),w0);range.putInteger(C('Srcm'),w1);
        range.putInteger(C('DstB'),u[0]);range.putInteger(C('Dstl'),u[1]);range.putInteger(C('DstW'),u[2]);range.putInteger(C('Dstt'),u[3]);
        list.putObject(C('Blnd'),range);layer.putList(C('Blnd'),list);d.putObject(C('T   '),C('Lyr '),layer);
        executeAction(C('setd'),d,DialogModes.NO);
    }
    function smart() {executeAction(S('newPlacedLayer'),undefined,DialogModes.NO);return app.activeDocument.activeLayer;}
    // Colour lives in adjustment layers in Color mode: they keep the light untouched, are cheap to
    // retune and stay editable in Properties. The COL mask keeps them off neutrals and skin.
    function colorLayers(doc,p,belowId) {
        var ids=[],sc=p.colorScale,c=p.color;selectLayerId(doc,belowId);
        if(p.presence>.02) {
            var v=new ActionDescriptor();v.putInteger(S('vibrance'),round(c.vibrance*sc)||0);v.putInteger(S('saturation'),round(c.saturation*sc)||0);
            var vl=adjustment('03 | СОЧНОСТЬ · '+round(c.vibrance*sc),S('vibrance'),v);vl.blendMode=BlendMode.COLORBLEND;maskFrom('COL',true);ids.push(vl.id);
            var d=new ActionDescriptor(),list=new ActionList();
            d.putEnumerated(S('presetKind'),S('presetKindType'),S('presetKindCustom'));
            for(var i=0;i<6;i++) {
                var row=new ActionDescriptor(),center=i*60;
                row.putInteger(S('localRange'),i+1);
                row.putInteger(S('beginRamp'),(center+315)%360);row.putInteger(S('beginSustain'),(center+345)%360);
                row.putInteger(S('endSustain'),(center+15)%360);row.putInteger(S('endRamp'),(center+45)%360);
                row.putInteger(S('hue'),0);row.putInteger(S('saturation'),round(c.bands[i]*sc)||0);row.putInteger(S('lightness'),0);
                list.putObject(S('hueSatAdjustmentV2'),row);
            }
            d.putList(S('adjustment'),list);
            var bl=adjustment('04 | ГЛУБИНА ЦВЕТА · 6 ДИАПАЗОНОВ',S('hueSaturation'),d);bl.blendMode=BlendMode.COLORBLEND;maskFrom('COL',true);ids.push(bl.id);
        }
        if(p.neutral<0) {
            var hs=new ActionDescriptor(),hl=new ActionList(),master=new ActionDescriptor();
            hs.putEnumerated(S('presetKind'),S('presetKindType'),S('presetKindCustom'));
            master.putInteger(C('H   '),0);master.putInteger(C('Strt'),p.neutral||0);master.putInteger(C('Lght'),0);
            hl.putObject(C('Hst2'),master);hs.putList(C('Adjs'),hl);
            var nl=adjustment('05 | ЧИСТЫЕ БЕЛЫЕ И СЕРЫЕ · '+(-p.neutral)+'%',C('HStr'),hs);maskFrom('NEU',true);ids.push(nl.id);
        }
        return ids;
    }
    function render(doc,p) {
        activeRGB(doc);doc.selection.deselect();
        var source=doc.activeLayer;source.name=MARKER;
        var group=doc.layerSets.add();group.name=PREFIX+' | ЦВЕТ + ОБЪЁМ';group.blendMode=BlendMode.NORMAL;
        source.move(group,ElementPlacement.INSIDE);doc.activeLayer=source;
        source=smart();source.name=MARKER;
        // Both Camera Raw layers start from the same untouched source: one pass each.
        var detail=source.duplicate();
        doc.activeLayer=source;acr(p.base);
        doc.activeLayer=detail;detail.name='02 | ОБЪЁМ + ТЕКСТУРА + РЕЗКОСТЬ · В ФОКУСЕ';
        acr(merged(p.base,p.detail));detail.blendMode=BlendMode.LUMINOSITY;
        // Detail fades out in deep shadows and near white, where it would crush or clip.
        blendIf(0,12,225,250);maskFrom('DET',false);
        var detailId=detail.id,color=colorLayers(doc,p,detailId);
        if(p.title)titleLayer(doc,p,color.length?color[color.length-1]:detailId);
        return {group:group,detailId:detailId,color:color};
    }
    // 06: dims the ground around the title so the letters stand out. Luminosity mode keeps the hue;
    // Blend If on the underlying layer leaves bright letters untouched, the HALO mask keeps it near the title.
    function titleLayer(doc,p,belowId) {
        selectLayerId(doc,belowId);
        var d=new ActionDescriptor(),list=new ActionList(),ch=new ActionDescriptor(),r=new ActionReference(),pl=new ActionList();
        d.putEnumerated(S('presetKind'),S('presetKindType'),S('presetKindCustom'));
        r.putEnumerated(C('Chnl'),C('Chnl'),C('Cmps'));ch.putReference(C('Chnl'),r);
        var pts=[[0,0],[255,round(255*(1-p.title.dim))]];
        for(var i=0;i<pts.length;i++){var pt=new ActionDescriptor();pt.putDouble(C('Hrzn'),pts[i][0]);pt.putDouble(C('Vrtc'),pts[i][1]);pl.putObject(C('Pnt '),pt);}
        ch.putList(C('Crv '),pl);list.putObject(C('CrvA'),ch);d.putList(C('Adjs'),list);
        var l=adjustment('06 | ПОДЛОЖКА ПОД ЗАГОЛОВКОМ · −'+round(p.title.dim*100)+'%',C('Crvs'),d);
        l.blendMode=BlendMode.LUMINOSITY;blendIf(0,0,255,255,[0,0,175,215]);maskFrom('HALO',true);
        return l.id;
    }
    function recolor(doc,r,p) {
        for(var i=r.color.length-1;i>=0;i--)deleteLayerId(r.color[i]);
        r.color=colorLayers(doc,p,r.detailId);
    }
    function quality(before,after,p) {
        var gain=before.chroma>.005?after.chroma/before.chroma-1:0;
        var f={gain:gain,crush:after.lostShadows-before.lostShadows>.006,clip:after.lostColor-before.lostColor>.02,white:after.lostWhite-before.lostWhite>.006,
            neutral:before.neutral.share>.004&&after.neutral.c>before.neutral.c*1.05+.002,
            skin:before.skin.share>.01&&after.skin.c>before.skin.c*1.12+.004,
            dark:after.mean<before.mean-.04,bright:after.mean>before.mean+.1};
        f.colorHigh=gain>p.colorCeiling;
        f.passed=!(f.crush||f.clip||f.white||f.neutral||f.skin||f.dark||f.bright);
        return f;
    }
    // Adjust only what caused a failure. Returns true when Camera Raw has to run again;
    // colour and neutral corrections just rebuild the cheap adjustment layers.
    function reduce(p,f) {
        var b=p.base,d=p.detail,toneClip=f.clip&&p.clipTries>0;
        if(f.crush){b.Bk12+=8;b.Sh12+=6;b.Cr12-=4;b.Dhze=Math.max(0,b.Dhze-3);d.Cl12=round(d.Cl12*.75);p.guards.push('shadows');}
        // New clipping is first answered with less colour; if it stays, contrast and highlights give way.
        if(f.white||toneClip){b.Cr12=Math.max(0,b.Cr12-5);d.Cl12=round(d.Cl12*.8);b.Hi12-=6;b.Wh12-=4;
            if(b.Ex12>0)b.Ex12=Math.round(b.Ex12*60)/100;p.guards.push('highlights');}
        if(f.clip){p.colorScale*=.75;p.clipTries++;p.guards.push('color');}
        if(f.neutral){p.neutral=Math.max(-90,Math.min(p.neutral,-40)-15);p.guards.push('neutral');}
        if(f.skin){b.Dhze=Math.max(0,b.Dhze-3);b.Temp=round(b.Temp/2);b.Cr12-=3;p.colorScale*=.9;p.guards.push('skin');}
        if(f.dark){b.Ex12=Math.round((b.Ex12+.1)*100)/100;b.Sh12+=6;p.guards.push('exposure');}
        if(f.bright){b.Ex12=Math.round((b.Ex12-.1)*100)/100;p.guards.push('exposure');}
        if(f.colorHigh)p.colorScale*=clamp(.85*p.colorCeiling/Math.max(f.gain,.01),.3,.9);
        p.colorScale=clamp(p.colorScale,.2,1);
        return !!(f.crush||f.white||toneClip||f.skin||f.dark||f.bright);
    }
    function describe(before,after,f) {
        var out=['chroma '+(f.gain>=0?'+':'')+Math.round(f.gain*100)+'%'],names=['crush','clip','white','neutral','skin','dark','bright','colorHigh'];
        for(var i=0;i<names.length;i++)if(f[names[i]])out.push(names[i]);
        return out.join(', ');
    }
    function copy(p) {
        var o={},k;for(k in p)if(p.hasOwnProperty(k))o[k]=(p[k]&&typeof p[k]==='object'&&!(p[k] instanceof Array))?merged(p[k],{}):p[k];
        o.guards=p.guards.slice(0);o.log=p.log.slice(0);return o;
    }
    function analyzeAndRender(work) {
        var started=new Date().getTime(),timing=[],tick=started;
        function lap(name){var t=new Date().getTime();timing.push(name+':'+(t-tick));tick=t;}
        var s=stats(pixels(work,128));lap('stats');
        // Estimate noise from full-size high-frequency luminance, not from a tiny
        // thumbnail where letters and textures can be mistaken for noise.
        var noiseDoc=null;
        try {
            noiseDoc=work.duplicate('SOCHNO noise analysis',true);activeRGB(noiseDoc);
            noiseDoc.bitsPerChannel=BitsPerChannelType.EIGHT;
            noiseDoc.activeLayer.applyHighPass(clamp(.6*work.width.as('px')/1280,.5,3));
            var hist=noiseDoc.histogram,n=total(hist);
            s.noise=(q(hist,n,.75)-q(hist,n,.25))/2;
        } finally {close(noiseDoc);app.activeDocument=work;}
        lap('noise');buildMasks(work,s);lap('masks');
        var before=measure(work,true);lap('measure0');
        var p=decide(s,before,work.width.as('px')),r=null,after=null,flags=null,lastPassed=null,full=true;
        var passes=PASSES;
        // Measure the real render; tone or detail problems re-run Camera Raw, colour-only ones just retune colour.
        for(var k=0;k<passes;k++) {
            if(full) {
                if(r){deleteLayerId(r.group.id);work.activeLayer=work.layers[0];}
                var backdrop=work.activeLayer;backdrop.duplicate();work.activeLayer=backdrop;
                r=render(work,p);
            } else recolor(work,r,p);
            p.passes=k+1;lap((full?'render':'recolor')+k);
            after=measure(work);flags=quality(before,after,p);lap('measure'+(k+1));
            p.log.push('pass '+(k+1)+': '+describe(before,after,flags));
            if(flags.passed)lastPassed=copy(p);
            if(flags.passed&&!flags.colorHigh)break;
            if(k===passes-1)break;
            full=reduce(p,flags);
        }
        // A later retune can fail where an earlier pass was fine: rebuild that one.
        if(!flags.passed&&lastPassed) {
            deleteLayerId(r.group.id);work.activeLayer=work.layers[0];
            p=lastPassed;var bd=work.activeLayer;bd.duplicate();work.activeLayer=bd;
            r=render(work,p);after=measure(work);flags=quality(before,after,p);lap('restore');
        }
        // Still failing: blend toward the original and verify each step rather than silently shipping a failure.
        var opacity=100;
        while(!flags.passed&&opacity>0) {
            opacity=Math.max(0,opacity-20);r.group.opacity=opacity;
            after=measure(work);flags=quality(before,after,p);
        }
        r.group.name=PREFIX+' 2.1 | ЦВЕТ + ОБЪЁМ · '+opacity+'%';
        return {group:r.group,before:before,after:after,stats:s,parameters:p,flags:flags,guardPassed:flags.passed,outputOpacity:opacity,
            ms:new Date().getTime()-started,timing:timing.join(' ')};
    }
    api.lastReport=null;
    api.run=function () {
        if(!app.documents.length)throw Error('Открой превью в Photoshop и снова запусти SOCHNO AUTO.');
        var src=app.activeDocument;
        if(src.mode!==DocumentMode.RGB || (src.bitsPerChannel!==BitsPerChannelType.EIGHT && src.bitsPerChannel!==BitsPerChannelType.SIXTEEN))
            throw Error('Для превью нужен режим RGB, 8 или 16 бит: Изображение → Режим.');
        var count=0,parent=src;
        for(var a=0;a<src.layerSets.length;a++)if(isArtboard(src.layerSets[a])){count++;parent=src.layerSets[a];}
        if(count>1)throw Error('Запусти на отдельном превью: в документе несколько монтажных областей.');
        var oldDialogs=app.displayDialogs,oldUnits=app.preferences.rulerUnits,oldState=src.activeHistoryState;
        var tmp=null;
        var work=function () {
            var prev=[];findOurs(src,prev);
            for(var i=0;i<prev.length;i++)prev[i].layer.visible=false;
            tmp=src.duplicate('SOCHNO processing',true);activeRGB(tmp);tmp.selection.deselect();
            var report=analyzeAndRender(tmp);
            var finalName=report.group.name,transferName=PREFIX+' transfer '+new Date().getTime()+' '+round(Math.random()*1e8);
            report.group.name=transferName;
            app.activeDocument=src;if(parent!==src)selectLayerId(src,parent.layers[0].id);
            app.activeDocument=tmp;
            report.group.duplicate(src,ElementPlacement.PLACEATBEGINNING);
            app.activeDocument=src;
            // The DOM object returned by cross-document duplicate can resolve to an
            // unrelated layer in a complex artboard. Re-find the tagged group, then
            // use stable layer IDs for selection and deletion after collection changes.
            var output=findNamedGroup(src,transferName);
            if(!output)throw Error('Не удалось найти перенесённую группу обработки.');
            var outputId=output.id;
            if(parent!==src && (output.parent.typename!=='LayerSet'||output.parent.id!==parent.id))
                throw Error('Не удалось поместить результат в исходную монтажную область.');
            // Only replace groups created by this script and bearing its source marker.
            for(i=prev.length-1;i>=0;i--)deleteLayerId(prev[i].id);
            output=selectLayerId(src,outputId);output.visible=true;output.name=finalName;activeRGB(src);
            api.lastReport={version:api.version,before:report.before,after:report.after,stats:report.stats,parameters:report.parameters,
                flags:report.flags,guardPassed:report.guardPassed,outputOpacity:report.outputOpacity,groupId:outputId,ms:report.ms,timing:report.timing};
        };
        try {
            app.displayDialogs=DialogModes.NO;app.preferences.rulerUnits=Units.PIXELS;
            $.global.SOCHNO_INTERNAL_WORK=work;
            src.suspendHistory('SOCHNO AUTO — обработать превью','SOCHNO_INTERNAL_WORK()');
            return api.lastReport;
        } catch(e) {
            close(tmp);tmp=null;app.activeDocument=src;
            try{src.activeHistoryState=oldState;}catch(rollback){}
            throw e;
        } finally {
            close(tmp);app.activeDocument=src;app.displayDialogs=oldDialogs;app.preferences.rulerUnits=oldUnits;
            $.global.SOCHNO_INTERNAL_WORK=undefined;
        }
    };
    api.analyze=function(doc){return stats(pixels(doc,128));};
    api.decide=decide;
    api.version='2.1.1';
    return api;
})();
if(!$.global.SOCHNO_NO_AUTORUN) {
    try {SOCHNO.run();} catch(e) {alert('SOCHNO AUTO\n\n'+e.message+'\nСтрока: '+e.line);}
}
