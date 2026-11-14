/**
 * 문자 코드 순서로 비교한다. localeCompare와 달리 브라우저·언어 설정에 따라 결과가 달라지지 않는다.
 * JS 문자열 비교는 UTF-16 코드 단위 순서이고, 한글·영문 같은 기본 다국어 평면 문자에서는
 * 유니코드 코드 포인트 순서와 같다. 대문자가 소문자보다 앞이다 ('B1' < 'a1').
 */
export function compareCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
