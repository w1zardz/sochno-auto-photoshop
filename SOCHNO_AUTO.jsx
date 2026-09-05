#target photoshop
/* SOCHNO AUTO 1.0 | Adaptive thumbnail finishing for Photoshop.
   Local, self-contained ExtendScript. RGB 8/16-bit. No network or paid plugins.
   One run = one undo step. Regenerates its own group from the unprocessed source.
   Copyright 2026. You may use and modify this script for any of your projects. */
var SOCHNO = (function () {
    var api = {}, C = charIDToTypeID, S = stringIDToTypeID;
    var PREFIX = 'SOCHNO AUTO', MARKER = 'SOCHNO_SOURCE_v1';
    function clamp(x,a,b) { return Math.max(a,Math.min(b,x)); }
    function round(x) { return Math.round(x); }
    function activeRGB(d) { app.activeDocument=d; d.activeChannels=d.componentChannels; }
    function close(d) { if(d) { try { d.close(SaveOptions.DONOTSAVECHANGES); } catch(e) {} } }
    function q(hist,n,p) { var s=0; for(var i=0;i<256;i++) {s+=hist[i]; if(s>=n*p)return i/255;} return 1; }
    function isOurs(g) {
        if(g.typename!=='LayerSet' || g.name.indexOf(PREFIX)!==0)return false;
        for(var i=0;i<g.artLayers.length;i++)if(g.artLayers[i].name===MARKER)return true;
        return false;
    }
    function findOurs(parent,arr) {
        for(var i=0;i<parent.layerSets.length;i++) {
            var g=parent.layerSets[i];
            if(isOurs(g))arr.push({layer:g,visible:g.visible}); else findOurs(g,arr);
        }
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
        for(var i=0;i<256;i++)h[i]=0;
        for(i=0;i<n;i++) {
            var c=px.rgb[i],y=px.y[i],mx=Math.max(c[0],c[1],c[2]),mn=Math.min(c[0],c[1],c[2]);
            var s=mx>0?(mx-mn)/mx:0;
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
                edge+=Math.abs(y-r)+Math.abs(y-d);ec+=2;
                var range=Math.max(l,r,u,d)-Math.min(l,r,u,d);
                if(range<.055&&y>.05&&y<.9)res[resCount++]=Math.abs(y-(l+r+u+d)/4);
            }
        }
        res.sort(function(a,b){return a-b;});
        return {mean:sum/n,median:q(h,n,.5),p05:q(h,n,.05),p10:q(h,n,.1),p90:q(h,n,.9),p95:q(h,n,.95),
            saturation:sat/n,hot:hot/n,white:white/n,black:black/n,colorClip:colorClip/n,shadows:shadow/n,highlights:light/n,
            edge:ec?edge/ec:0,noise:res.length>50?res[Math.floor(res.length*.65)]:0,noiseSamples:res.length};
    }
    function decide(s,width) {
        var flat=clamp((.72-(s.p90-s.p10))/.5,0,1),rich=clamp((s.saturation-.32)/.4,0,1);
        var noisy=clamp((s.noise-.004)/.020,0,1),detailed=clamp((s.edge-.045)/.08,0,1);
        return {
            lift:clamp((.57-s.mean)*100,-14,32),contrast:12+flat*20,
            shadows:round(clamp(8+s.shadows*35+(s.mean<.33?8:0),6,30)),
            highlights:round(clamp(s.highlights*38,0,12)),
            vibrance:round(clamp(72-rich*28-s.hot*20,22,72)),
            saturation:round(clamp(15-rich*7-s.hot*7,3,15)),
            clarity:round((31+flat*16-detailed*10)*(1-noisy*.45)),
            texture:round((24+flat*12)*(1-noisy*.65)),
            sharp:round((120-detailed*40)*(1-noisy*.55)),
            threshold:round(2+noisy*5),noiseOpacity:noisy>.35?round(12+noisy*20):0,
            scale:clamp(width/1280,.25,6),guard:1,passes:0
        };
    }
    function curvePoints(p) {
        var xs=[0,16,48,96,128,176,224,248,255],out=[],last=-1;
        var L=p.lift,G=p.guard,K=p.contrast*G;
        var ys=[0,16-K*.23,48+L*.55-K*.6,96+L*.9-K*.3,128+L,176+L*.48+K,224+L*.08+K*.15,248,255];
        for(var i=0;i<xs.length;i++){var v=clamp(round(ys[i]),last+1,255-(xs.length-1-i));out.push([xs[i],v]);last=v;}
        return out;
    }
    function adjustment(name,type,settings) {
        var d=new ActionDescriptor(),r=new ActionReference(),u=new ActionDescriptor();
        r.putClass(S('adjustmentLayer')); d.putReference(C('null'),r);u.putString(C('Nm  '),name);
        u.putObject(C('Type'),type,settings);d.putObject(C('Usng'),S('adjustmentLayer'),u);
        executeAction(C('Mk  '),d,DialogModes.NO);return app.activeDocument.activeLayer;
    }
    function curves(p) {
        var d=new ActionDescriptor(),a=new ActionList(),ch=new ActionDescriptor(),r=new ActionReference(),pts=new ActionList();
        r.putEnumerated(C('Chnl'),C('Chnl'),C('Cmps'));ch.putReference(C('Chnl'),r);
        var points=curvePoints(p);
        for(var i=0;i<points.length;i++){var pt=new ActionDescriptor();pt.putDouble(C('Hrzn'),points[i][0]);pt.putDouble(C('Vrtc'),points[i][1]);pts.putObject(C('Pnt '),pt);}
        ch.putList(C('Crv '),pts);a.putObject(C('CrvA'),ch);d.putList(C('Adjs'),a);
        var layer=adjustment('03 | СВЕТ + КОНТРАСТ · AUTO',C('Crvs'),d);layer.blendMode=BlendMode.LUMINOSITY;
        return layer;
    }
    function vibrance(p) {
        var d=new ActionDescriptor();d.putInteger(S('vibrance'),round(p.vibrance*p.guard));d.putInteger(S('saturation'),round(p.saturation*p.guard));
        var l=adjustment('04 | СОЧНОСТЬ · AUTO '+round(p.vibrance*p.guard),S('vibrance'),d);l.blendMode=BlendMode.COLORBLEND;return l;
    }
    function smart() {executeAction(S('newPlacedLayer'),undefined,DialogModes.NO);return app.activeDocument.activeLayer;}
    function usm(amount,radius,threshold) {
        var d=new ActionDescriptor();d.putUnitDouble(C('Amnt'),C('#Prc'),amount);d.putUnitDouble(C('Rds '),C('#Pxl'),radius);d.putInteger(C('Thsh'),threshold);
        executeAction(C('UnsM'),d,DialogModes.NO);
    }
    function render(doc,p) {
        activeRGB(doc);doc.selection.deselect();
        var source=doc.activeLayer;source.name=MARKER;
        var group=doc.layerSets.add();group.name=PREFIX+' | ЖЁСТКИЙ АВТОФИНИШ';group.blendMode=BlendMode.NORMAL;
        source.move(group,ElementPlacement.INSIDE);doc.activeLayer=source;
        source=smart();source.name=MARKER;
        var base=source;
        if(p.noiseOpacity>0) {
            var smooth=source.duplicate();doc.activeLayer=smooth;
            executeAction(C('Mdn '),(function(){var d=new ActionDescriptor();d.putUnitDouble(C('Rds '),C('#Pxl'),1);return d;})(),DialogModes.NO);
            smooth.name='00 | МЯГКОЕ ПОДАВЛЕНИЕ ШУМА';smooth.opacity=p.noiseOpacity;smooth.blendMode=BlendMode.LUMINOSITY;
            // Keep the original marker, but use a rendered composite for subsequent detail passes.
            var temp=doc.duplicate('SOCHNO denoise merge',true);
            var merged=temp.activeLayer.duplicate(doc,ElementPlacement.PLACEATBEGINNING);close(temp);activeRGB(doc);
            merged.move(group,ElementPlacement.INSIDE);doc.activeLayer=merged;base=smart();base.name='01 | БАЗА ПОСЛЕ ШУМА';
        }
        // Local tonal recovery, with no black/white percentile clipping.
        doc.activeLayer=base;
        base.shadowHighlight(round(p.shadows*p.guard),38,round(32*p.scale),round(p.highlights*p.guard),24,round(28*p.scale),0,0,0,0);
        // Separate Luminosity layer prevents colored halos in high-contrast graphics.
        var detail=base.duplicate();doc.activeLayer=detail;detail.name='02 | ОБЪЁМ + ТЕКСТУРА + ЧЁТКОСТЬ · AUTO';detail.blendMode=BlendMode.LUMINOSITY;
        usm(round(p.clarity*p.guard),clamp(18*p.scale,3,100),p.threshold);
        usm(round(p.texture*p.guard),clamp(2.2*p.scale,.6,12),p.threshold);
        usm(round(p.sharp*p.guard),clamp(.65*p.scale,.35,2.5),p.threshold);
        var tone=curves(p);tone.move(group,ElementPlacement.INSIDE);
        doc.activeLayer=tone;var color=vibrance(p);color.move(group,ElementPlacement.INSIDE);
        doc.activeLayer=group;return group;
    }
    function analyzeAndRender(merged) {
        var original=stats(pixels(merged,128));
        // Estimate noise from full-size high-frequency luminance, not from a tiny
        // thumbnail where letters and textures can be mistaken for noise.
        var noiseDoc=null;
        try {
            noiseDoc=merged.duplicate('SOCHNO noise analysis',true);activeRGB(noiseDoc);
            noiseDoc.bitsPerChannel=BitsPerChannelType.EIGHT;
            noiseDoc.activeLayer.applyHighPass(clamp(.6*merged.width.as('px')/1280,.5,3));
            var hist=noiseDoc.histogram,total=0;
            for(var ni=0;ni<hist.length;ni++)total+=hist[ni];
            original.noise=(q(hist,total,.75)-q(hist,total,.25))/2;
        } finally {close(noiseDoc);app.activeDocument=merged;}
        var p=decide(original,merged.width.as('px'));
        var trial=null,result,accepted=false;
        // Evaluate actual Photoshop rendering, not just the intended slider values.
        for(var k=0;k<4;k++) {
            try {
                trial=merged.duplicate('SOCHNO quality check',true);activeRGB(trial);
                var ratio=Math.min(1,640/Math.max(trial.width.as('px'),trial.height.as('px')));
                if(ratio<1)trial.resizeImage(UnitValue(round(trial.width.as('px')*ratio),'px'),UnitValue(round(trial.height.as('px')*ratio),'px'),null,ResampleMethod.BICUBIC);
                var fullScale=p.scale;p.scale=fullScale*ratio;render(trial,p);p.scale=fullScale;
                result=stats(pixels(trial,128));p.passes=k+1;
                // White text and existing neon are excluded from "new clipping" allowances.
                var badWhite=result.white>original.white+.018;
                var badBlack=result.black>original.black+.015;
                var badColor=result.colorClip>original.colorClip+.065;
                var badSat=result.hot>original.hot+.12;
                if(!badWhite&&!badBlack&&!badColor&&!badSat){accepted=true;break;}
                if(k<3){p.guard*=.7;if(badWhite)p.lift*=.78;}
            } finally {close(trial);trial=null;app.activeDocument=merged;}
        }
        var group=render(merged,p);
        group.name=PREFIX+' | ЖЁСТКИЙ АВТОФИНИШ · '+round(p.guard*100)+'%';
        return {group:group,before:original,after:result,parameters:p,guardPassed:accepted};
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
            var output=report.group.duplicate(src,ElementPlacement.PLACEATBEGINNING);
            activeRGB(src);
            // Photoshop can place a duplicated group inside the active artboard
            // automatically. Moving it "inside" that same artboard then errors.
            if(parent!==src && (output.parent.typename!=='LayerSet'||output.parent.id!==parent.id))
                output.move(parent.layers[0],ElementPlacement.PLACEBEFORE);
            output.visible=true;
            // Only replace groups created by this script and bearing its source marker.
            for(i=prev.length-1;i>=0;i--)prev[i].layer.remove();
            src.activeLayer=output;
            api.lastReport={before:report.before,after:report.after,parameters:report.parameters,guardPassed:report.guardPassed,groupId:output.id};
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
    return api;
})();
if(!$.global.SOCHNO_NO_AUTORUN) {
    try {SOCHNO.run();} catch(e) {alert('SOCHNO AUTO\n\n'+e.message+'\nСтрока: '+e.line);}
}
