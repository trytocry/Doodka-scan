using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public class PaperStock { public int id; public string name; public double width; public double height; }
public class PaperState { public PaperStock[] stocks; public int currentId; public double width; public double height; public bool cancelled; }
public static class PrinterDriver {
 [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
 [DllImport("winspool.drv")] static extern bool ClosePrinter(IntPtr printer);
 [DllImport("winspool.drv", CharSet=CharSet.Unicode)] static extern int DocumentProperties(IntPtr owner, IntPtr printer, string name, IntPtr output, IntPtr input, int mode);
 [DllImport("winspool.drv", CharSet=CharSet.Unicode)] static extern int DeviceCapabilities(string name, string port, short capability, IntPtr output, IntPtr devmode);
 [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetPrinter(IntPtr printer, int level, IntPtr buffer, int size, out int needed);
 [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetPrinter(IntPtr printer, int level, IntPtr info, int command);
 static Exception Error(string text) { return new Exception(text+": "+new Win32Exception(Marshal.GetLastWin32Error()).Message); }
 static IntPtr Read(IntPtr h, string name) {
   int length=DocumentProperties(IntPtr.Zero,h,name,IntPtr.Zero,IntPtr.Zero,0);
   if(length<84 || length>16777216) throw new Exception("Driver returned invalid settings size.");
   IntPtr dm=Marshal.AllocHGlobal(length);
   try {
     if(DocumentProperties(IntPtr.Zero,h,name,dm,IntPtr.Zero,2)!=1) throw new Exception("Cannot read driver settings.");
     int needed; GetPrinter(h,9,IntPtr.Zero,0,out needed);
     if(needed>0 && needed<16777216) {
       IntPtr info=Marshal.AllocHGlobal(needed);
       try { if(GetPrinter(h,9,info,needed,out needed)) {
         IntPtr source=Marshal.ReadIntPtr(info);
         if(source!=IntPtr.Zero) {
           int n=(ushort)Marshal.ReadInt16(source,68)+(ushort)Marshal.ReadInt16(source,70);
           if(n>=84 && n<=length) { byte[] bytes=new byte[n]; Marshal.Copy(source,bytes,0,n); Marshal.Copy(bytes,0,dm,n); }
         }
       }} finally {Marshal.FreeHGlobal(info);}
     }
     return dm;
   } catch {Marshal.FreeHGlobal(dm);throw;}
 }
 static PaperStock[] Stocks(string name, IntPtr dm) {
   int count=DeviceCapabilities(name,null,2,IntPtr.Zero,dm);
   if(count<0) return new PaperStock[0];
   if(count>4096) throw new Exception("Too many paper profiles.");
   if(count==0) return new PaperStock[0];
   IntPtr ids=Marshal.AllocHGlobal(4096*2), names=Marshal.AllocHGlobal(4096*128), sizes=Marshal.AllocHGlobal(4096*8);
   try {
     // Refuse a changing capability list rather than reading mismatched buffers.
     if(DeviceCapabilities(name,null,16,IntPtr.Zero,dm)!=count || DeviceCapabilities(name,null,3,IntPtr.Zero,dm)!=count) throw new Exception("Paper profile list changed. Refresh it.");
     if(DeviceCapabilities(name,null,2,ids,dm)!=count || DeviceCapabilities(name,null,16,names,dm)!=count || DeviceCapabilities(name,null,3,sizes,dm)!=count) throw new Exception("Cannot read paper profiles.");
     var result=new List<PaperStock>();
     for(int i=0;i<count;i++) result.Add(new PaperStock { id=(ushort)Marshal.ReadInt16(ids,i*2), name=Marshal.PtrToStringUni(IntPtr.Add(names,i*128),64).Split('\0')[0], width=Marshal.ReadInt32(sizes,i*8)/10.0, height=Marshal.ReadInt32(sizes,i*8+4)/10.0 });
     return result.ToArray();
   } finally {Marshal.FreeHGlobal(ids);Marshal.FreeHGlobal(names);Marshal.FreeHGlobal(sizes);}
 }
 static PaperState State(string name, IntPtr dm) {
   return new PaperState {stocks=Stocks(name,dm), currentId=(ushort)Marshal.ReadInt16(dm,78), width=Marshal.ReadInt16(dm,82)/10.0, height=Marshal.ReadInt16(dm,80)/10.0};
 }
 public static PaperState Run(string name, string action, int stockId, long owner) {
   IntPtr h; if(!OpenPrinter(name,out h,IntPtr.Zero)) throw Error("Cannot open printer");
   IntPtr dm=IntPtr.Zero;
   try {
     dm=Read(h,name);
     if(action=="list") return State(name,dm);
     if(action=="apply") {
       PaperStock stock=Array.Find(Stocks(name,dm), p=>p.id==stockId);
       if(stock==null) throw new Exception("Paper profile no longer exists. Refresh the list.");
       int fields=Marshal.ReadInt32(dm,72);
       Marshal.WriteInt32(dm,72,(fields & ~0x1000C) | 2);
       Marshal.WriteInt16(dm,78,(short)stockId);
       if(DocumentProperties(IntPtr.Zero,h,name,dm,dm,10)!=1) throw new Exception("Driver rejected paper profile.");
       if((ushort)Marshal.ReadInt16(dm,78)!=stockId) throw new Exception("Driver selected a different paper profile.");
     } else if(action=="edit") {
       int result=DocumentProperties(new IntPtr(owner),h,name,dm,dm,14);
       if(result==2) { var cancelled=State(name,dm); cancelled.cancelled=true; return cancelled; }
       if(result!=1) throw new Exception("Cannot open driver preferences.");
     } else throw new Exception("Unknown operation.");
     IntPtr info=Marshal.AllocHGlobal(IntPtr.Size);
     try {Marshal.WriteIntPtr(info,dm);if(!SetPrinter(h,9,info,0))throw Error("Cannot save Windows printing preferences");}
     finally {Marshal.FreeHGlobal(info);}
     Marshal.FreeHGlobal(dm);dm=IntPtr.Zero;dm=Read(h,name);
     var state=State(name,dm);
     if(action=="apply" && state.currentId!=stockId) throw new Exception("Windows did not save the selected profile.");
     return state;
   } finally {if(dm!=IntPtr.Zero)Marshal.FreeHGlobal(dm);ClosePrinter(h);}
 }
}
