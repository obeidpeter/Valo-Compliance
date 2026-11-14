/** PDF extraction can omit visual inter-word spacing. Preserve every non-whitespace character. */
export function readerContainsText(actual:string,expected:string){
  const needle=expected.replace(/\s+/g,"");
  return needle.length>0&&actual.replace(/\s+/g,"").includes(needle);
}
