/** Scenario files are bundled as strings (the "loader" option in angular.json). */
declare module '*.txt' {
  const text: string;
  export default text;
}
declare module '*.expected' {
  const text: string;
  export default text;
}
